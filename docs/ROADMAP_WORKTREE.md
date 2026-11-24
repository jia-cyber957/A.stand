# Optional Git Worktree Isolation for Parallel Writers

> **Status**: Implemented (Opt-in Setting: allowWorktreeParallelWrite)

* `oracle` supports parallel read-only slots within `maxConcurrency`.
* `hephaestus` uses a per-workspace write mutex by default. Enable **Git Worktree Parallel Writers** in Settings to allow concurrent writers in a Git checkout with an existing commit. Non-Git directories still use the mutex.
* When enabled, A.stand launches a second writer for a busy Git checkout in a new worktree. Pass `worktree: true` to isolate a job explicitly. Each isolated job starts a fresh session from `HEAD` on branch `astand/<jobId>` under `<dataDir>/worktrees/<jobId>`.
* A.stand prunes worktrees that finish with no local changes and no new commits. For a retained worktree, inspect and commit any local changes, then run `git merge astand/<jobId>` and `git worktree remove "<worktreePath>"` from the source checkout. Use the retained worktree's working directory for session follow-ups.
* Tests should use ephemeral ports (`port: 0`). Worktrees share machine resources such as ports and databases.
