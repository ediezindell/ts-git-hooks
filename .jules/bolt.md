## 2026-01-21 - Lazy loading of staged files
**Learning:** `git diff --cached` (spawned process) was being called unconditionally for all hooks, even those that don't need file arguments (like `pre-push: npm test`). This adds ~50-100ms overhead to every hook execution.
**Action:** Implemented `shouldFetchStagedFiles` to check if the hook configuration requires files (Glob hooks or Simple hooks with custom argument functions) before spawning git.

## 2026-01-21 - Skip stashing for metadata hooks
**Learning:** `git stash push` and `git stash pop` were being called unconditionally for all hooks if unstaged changes were present. This is unnecessary for hooks like `commit-msg` or `post-commit` that do not touch the working directory files. This adds significant overhead (seconds on large repos).
**Action:** Implemented an exclusion list for stashing. `commit-msg`, `prepare-commit-msg`, and `post-*` hooks now skip the stashing step.

## 2026-01-21 - Use spawn for git operations
**Learning:** `child_process.exec` spawns a shell, which adds overhead and requires careful string escaping. `child_process.spawn` is faster (no shell) and safer (array arguments).
**Action:** Refactored `src/utils/git.ts` to use `spawn` instead of `exec`.
