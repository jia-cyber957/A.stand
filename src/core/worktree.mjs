import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(cwd, args, timeout = 5000) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout,
  });
}

export function detectGitRepo(cwd) {
  try {
    const dir = fs.realpathSync(cwd);
    const repoRoot = path.normalize(git(dir, ["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, ""));
    const headSha = git(dir, ["rev-parse", "HEAD"]).trim();
    const relSubdir = path.relative(repoRoot, dir);
    if (relSubdir === ".." || relSubdir.startsWith(`..${path.sep}`) || path.isAbsolute(relSubdir)) {
      return { isGit: false };
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

function hydrateWorktree({ repoRoot, worktreeRoot, relSubdir = "" }) {
  const bases = relSubdir ? ["", relSubdir] : [""];
  const seen = new Set();

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
        linkDirSafe(src, path.join(worktreeRoot, rel));
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
      if (st.isDirectory()) linkDirSafe(src, path.join(worktreeRoot, rel));
      else if (st.isFile()) copyFileSafe(src, path.join(worktreeRoot, rel), MAX_INCLUDE_COPY_BYTES);
    } catch {}
  }
}

function unlinkWorktreeLinks({ repoRoot, worktreeRoot, effectiveCwd }) {
  const relSubdir = effectiveCwd ? safeRelPath(path.relative(worktreeRoot, effectiveCwd)) : "";
  const bases = relSubdir ? ["", relSubdir] : [""];
  const candidates = new Set();
  for (const base of bases) {
    for (const dep of LINKABLE_DEP_DIRS) {
      candidates.add(base ? path.join(base, dep.name) : dep.name);
    }
  }
  for (const rel of readWorktreeInclude(repoRoot)) {
    candidates.add(rel);
  }
  for (const rel of candidates) {
    const p = path.join(worktreeRoot, rel);
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st || !st.isSymbolicLink()) continue;
    try {
      fs.unlinkSync(p);
    } catch {
      try {
        fs.rmdirSync(p);
      } catch {}
    }
  }
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
  const status = git(worktreeRoot, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignore-submodules=none"], 60_000);
  const entries = status.split("\0");
  let changedFilesCount = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    changedFilesCount++;
    // In porcelain -z, renames and copies have a second, NUL-delimited path.
    if (/[RC]/.test(entries[i].slice(0, 2))) i++;
  }
  let commitsCount = Number(git(worktreeRoot, ["rev-list", "--count", `${baseHead}..HEAD`]).trim());
  if (changedFilesCount === 0 && commitsCount === 0) {
    // HEAD may have moved to a different branch. Check the job branch before deleting it.
    commitsCount = Number(git(repoRoot, ["rev-list", "--count", `${baseHead}..refs/heads/${branch}`]).trim());
  }
  if (changedFilesCount || commitsCount) {
    return { kept: true, pruned: false, branch, worktreeRoot, changedFilesCount, commitsCount };
  }
  unlinkWorktreeLinks(wt);
  git(repoRoot, ["worktree", "remove", "--force", worktreeRoot], 60_000);
  git(repoRoot, ["branch", "-D", branch]);
  return { kept: false, pruned: true };
}
