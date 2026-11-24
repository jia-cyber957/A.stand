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
  git(repoRoot, ["worktree", "remove", "--force", worktreeRoot], 60_000);
  git(repoRoot, ["branch", "-D", branch]);
  return { kept: false, pruned: true };
}
