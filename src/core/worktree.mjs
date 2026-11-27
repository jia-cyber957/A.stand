import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(cwd, args, timeout = 5000) {
  // Shared/SMB repositories commonly trip Git's dubious-ownership guard; `safe.directory=*` keeps
  // worktree isolation working without mutating the user's global Git config.
  return execFileSync("git", ["-c", "safe.directory=*", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout,
  });
}

/** Windows path namespace: `drive` (Z:\...), `unc` (\\host\share\...) or `posix`. */
function pathNamespace(value) {
  const raw = String(value || "");
  if (/^[\\/]{2}[^\\/]/.test(raw)) return "unc";
  if (/^[A-Za-z]:[\\/]/.test(raw) || /^[A-Za-z]:$/.test(raw)) return "drive";
  return "posix";
}

/** Normalize `git rev-parse --show-prefix` output to a native relative path ("" at repo root). */
export function relSubdirFromPrefix(prefix) {
  return String(prefix || "")
    .replace(/\r?\n$/, "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join(path.sep);
}

/**
 * Derive the repository root on the SAME path namespace as `dir` by walking `relSubdir`'s
 * segment count upwards. This avoids `path.relative()` returning an absolute path when Git
 * reports a UNC toplevel for a mapped drive (Z:\share\repo vs \\host\share\repo).
 */
export function resolveRepoRootFromPrefix(dir, relSubdir = "") {
  let root = path.resolve(dir);
  const segments = String(relSubdir || "").split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < segments.length; i++) root = path.dirname(root);
  return path.normalize(root);
}

function hasGitMarker(root) {
  if (!root) return false;
  try {
    return fs.existsSync(path.join(root, ".git"));
  } catch {
    return false;
  }
}

function realpathSameNamespace(cwd) {
  try {
    const real = fs.realpathSync.native ? fs.realpathSync.native(cwd) : fs.realpathSync(cwd);
    return real && pathNamespace(real) === pathNamespace(cwd) ? real : "";
  } catch {
    return "";
  }
}

export function detectGitRepo(cwd) {
  try {
    let dir = path.resolve(cwd);
    const realDir = realpathSameNamespace(dir);
    if (realDir) dir = realDir;

    // `--show-prefix` is relative to the repository root and always uses `/`, so it stays
    // reliable across drive-vs-UNC aliases (unlike path.relative between two namespaces).
    const relSubdir = relSubdirFromPrefix(git(dir, ["rev-parse", "--show-prefix"]));
    const headSha = git(dir, ["rev-parse", "HEAD"]).trim();

    let repoRoot = relSubdir ? "" : dir;
    if (!repoRoot || !hasGitMarker(repoRoot)) {
      const candidates = [];
      if (relSubdir) candidates.push(resolveRepoRootFromPrefix(dir, relSubdir));
      try {
        const top = path.normalize(git(dir, ["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, ""));
        if (top) candidates.push(top);
      } catch {}
      candidates.push(dir);
      repoRoot = candidates.find(hasGitMarker) || candidates[0] || dir;
    }
    return { isGit: true, repoRoot, headSha, relSubdir };
  } catch {
    return { isGit: false };
  }
}

const LINKABLE_DEP_DIRS = [
  { name: "node_modules" },
  { name: ".venv" },
  { name: "venv" },
  { name: "env", requireChild: "pyvenv.cfg" },
  { name: "vendor" },
  { name: ".bundle" },
  { name: ".pnpm-store" },
];

const COPYABLE_LOCAL_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  "config.local.json",
  "settings.local.json",
  ".npmrc",
];

const MAX_COPY_BYTES = 256 * 1024;
const MAX_INCLUDE_COPY_BYTES = 2 * 1024 * 1024;

function isGitIgnored(repoRoot, relPath) {
  try {
    git(repoRoot, ["check-ignore", "-q", "--", relPath.replace(/\\/g, "/")], 3000);
    return true;
  } catch {
    return false;
  }
}

function safeRelPath(raw) {
  const norm = path.normalize(String(raw || "").trim().replace(/^[/\\]+/, ""));
  if (!norm || norm === "." || norm === ".." || norm.startsWith(`..${path.sep}`) || path.isAbsolute(norm)) {
    return "";
  }
  const first = norm.split(path.sep)[0];
  if (first === ".git") return "";
  return norm;
}

function readWorktreeInclude(repoRoot) {
  const fp = path.join(repoRoot, ".worktreeinclude");
  if (!fs.existsSync(fp)) return [];
  try {
    return fs
      .readFileSync(fp, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim())
      .map(safeRelPath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function linkDirSafe(src, dst) {
  if (fs.lstatSync(dst, { throwIfNoEntry: false })) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const type = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(src, dst, type);
  return true;
}

function copyFileSafe(src, dst, maxBytes) {
  if (fs.lstatSync(dst, { throwIfNoEntry: false })) return false;
  const st = fs.lstatSync(src, { throwIfNoEntry: false });
  if (!st || !st.isFile() || st.size > maxBytes) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

// Tracks exact relative paths symlinked/junctioned by hydrateWorktree per worktreeRoot
// (kept off the returned wt object to preserve its plain shape).
const HYDRATED_LINKS = new Map(); // worktreeRoot -> Set<string> (POSIX-normalized rel paths)

function toPosixRel(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function isInsideDir(rootReal, targetPath) {
  const rel = path.relative(rootReal, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function hydrateWorktree({ repoRoot, worktreeRoot, relSubdir = "" }) {
  const bases = relSubdir ? ["", relSubdir] : [""];
  const seen = new Set();
  const createdLinks = new Set();

  for (const base of bases) {
    for (const dep of LINKABLE_DEP_DIRS) {
      const rel = base ? path.join(base, dep.name) : dep.name;
      if (seen.has(rel)) continue;
      seen.add(rel);
      const src = path.join(repoRoot, rel);
      const st = fs.lstatSync(src, { throwIfNoEntry: false });
      if (!st || !st.isDirectory()) continue;
      if (dep.requireChild && !fs.existsSync(path.join(src, dep.requireChild))) continue;
      if (!isGitIgnored(repoRoot, rel)) continue;
      try {
        if (linkDirSafe(src, path.join(worktreeRoot, rel))) createdLinks.add(toPosixRel(rel));
      } catch {}
    }

    for (const fname of COPYABLE_LOCAL_FILES) {
      const rel = base ? path.join(base, fname) : fname;
      if (seen.has(rel)) continue;
      seen.add(rel);
      const src = path.join(repoRoot, rel);
      const st = fs.lstatSync(src, { throwIfNoEntry: false });
      if (!st || !st.isFile()) continue;
      if (!isGitIgnored(repoRoot, rel)) continue;
      try {
        copyFileSafe(src, path.join(worktreeRoot, rel), MAX_COPY_BYTES);
      } catch {}
    }
  }

  // Optional .worktreeinclude (Cursor / Claude Code convention) for extra ignored local deps/configs.
  for (const rel of readWorktreeInclude(repoRoot)) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = path.join(repoRoot, rel);
    const st = fs.lstatSync(src, { throwIfNoEntry: false });
    if (!st) continue;
    if (!isGitIgnored(repoRoot, rel)) continue;
    try {
      if (st.isDirectory()) {
        if (linkDirSafe(src, path.join(worktreeRoot, rel))) createdLinks.add(toPosixRel(rel));
      } else if (st.isFile()) {
        copyFileSafe(src, path.join(worktreeRoot, rel), MAX_INCLUDE_COPY_BYTES);
      }
    } catch {}
  }

  if (createdLinks.size > 0) HYDRATED_LINKS.set(worktreeRoot, createdLinks);
}

function unlinkWorktreeLinks(worktreeRoot) {
  const links = HYDRATED_LINKS.get(worktreeRoot);
  if (!links || links.size === 0) return;
  const rootReal = fs.realpathSync(worktreeRoot);
  for (const posixRel of links) {
    const p = path.join(worktreeRoot, ...posixRel.split("/"));
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (!st.isSymbolicLink()) continue;
    const parentReal = fs.realpathSync(path.dirname(p));
    if (!isInsideDir(rootReal, parentReal)) {
      throw new Error(`Refusing to unlink hydration link outside worktree: ${p}`);
    }
    try {
      fs.unlinkSync(p);
    } catch {
      fs.rmdirSync(p);
    }
    if (fs.lstatSync(p, { throwIfNoEntry: false })) {
      throw new Error(`Failed to unlink hydration link before worktree removal: ${p}`);
    }
  }
  HYDRATED_LINKS.delete(worktreeRoot);
}

export function createJobWorktree({ dataDir, repoRoot, relSubdir = "", jobId }) {
  const worktreeRoot = path.resolve(dataDir, "worktrees", jobId);
  const branch = `astand/${jobId}`;
  fs.mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  git(repoRoot, ["worktree", "add", "-b", branch, worktreeRoot, "HEAD"], 60_000);
  const baseHead = git(worktreeRoot, ["rev-parse", "HEAD"]).trim();
  const wt = {
    worktreeRoot,
    effectiveCwd: path.join(worktreeRoot, relSubdir),
    branch,
    repoRoot,
    baseHead,
  };
  try {
    // Git omits empty and untracked directories. Recreate only the cwd's directory path.
    let dir = worktreeRoot;
    for (const component of relSubdir.split(path.sep).filter(Boolean)) {
      dir = path.join(dir, component);
      const entry = fs.lstatSync(dir, { throwIfNoEntry: false });
      if (!entry) fs.mkdirSync(dir);
      else if (!entry.isDirectory()) throw new Error(`Worktree cwd is not a directory: ${dir}`);
    }
    hydrateWorktree({ repoRoot, worktreeRoot, relSubdir });
    return wt;
  } catch (err) {
    try { finalizeJobWorktree(wt); } catch {}
    throw err;
  }
}

export function finalizeJobWorktree(wt) {
  const { worktreeRoot, repoRoot, branch, baseHead } = wt;
  const links = HYDRATED_LINKS.get(worktreeRoot);
  const status = git(worktreeRoot, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignore-submodules=none"], 60_000);
  const entries = status.split("\0");
  let changedFilesCount = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    const line = entries[i];
    const code = line.slice(0, 2);
    const relPath = toPosixRel(line.slice(3));
    // In porcelain -z, renames and copies have a second, NUL-delimited path.
    if (/[RC]/.test(code)) {
      changedFilesCount++;
      i++;
      continue;
    }
    // On POSIX, Git's directory-only ignore patterns (e.g. `node_modules/`) do not ignore a symlink.
    // Skip verified hydration symlinks we created so clean worktrees still prune cleanly.
    if (code === "??" && links?.has(relPath)) {
      const p = path.join(worktreeRoot, ...relPath.split("/"));
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (st?.isSymbolicLink()) continue;
    }
    changedFilesCount++;
  }
  let commitsCount = Number(git(worktreeRoot, ["rev-list", "--count", `${baseHead}..HEAD`]).trim());
  if (changedFilesCount === 0 && commitsCount === 0) {
    // HEAD may have moved to a different branch. Check the job branch before deleting it.
    commitsCount = Number(git(repoRoot, ["rev-list", "--count", `${baseHead}..refs/heads/${branch}`]).trim());
  }
  if (changedFilesCount || commitsCount) {
    return { kept: true, pruned: false, branch, worktreeRoot, changedFilesCount, commitsCount };
  }
  unlinkWorktreeLinks(worktreeRoot);
  git(repoRoot, ["worktree", "remove", "--force", worktreeRoot], 60_000);
  git(repoRoot, ["branch", "-D", branch]);
  return { kept: false, pruned: true };
}
