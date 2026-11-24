# Future Roadmap: Optional Git Worktree Isolation for Parallel Writers

> **Status**: Deferred (planned as an opt-in Advanced Setting, OFF by default).

## Problem
Currently, `oracle` (read-only) scales freely up to `maxConcurrency`, while `hephaestus` (workspace-write) enforces a strict per-workspace write mutex so two writers never overwrite each other's files.

## Planned Design (Inspired by Claude Code `--worktree` & Codex `--worktree`)
1. **Opt-in Setting (`allowWorktreeParallelWrite`, default `false`)**:
   - Exposed in **Settings → Advanced** with clear transparency: requires a Git repository with clean base commits.
   - Non-Git directories always fall back cleanly to the existing per-workspace write mutex.
2. **Lifecycle**:
   - When enabled and a second `hephaestus` task targets the same Git repo, `agent-relay` creates an isolated checkout under `<repo>/.agent-relay-worktrees/<jobId>` (`git worktree add -b relay/<jobId>`).
   - Each writer edits, tests, and commits strictly inside its own worktree directory.
   - Clean unmodified worktrees are pruned automatically on completion; worktrees with changes remain inspectable so the lead agent or user can review and merge cleanly before removing (`git worktree remove`).
3. **Runtime Port/State Caution**:
   - Worktrees isolate source files, not shared local ports or databases; prompts should remind parallel writers to use ephemeral ports (`port: 0`) during tests.
