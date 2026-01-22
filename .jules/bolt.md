## 2026-01-21 - Lazy loading of staged files
**Learning:** `git diff --cached` (spawned process) was being called unconditionally for all hooks, even those that don't need file arguments (like `pre-push: npm test`). This adds ~50-100ms overhead to every hook execution.
**Action:** Implemented `shouldFetchStagedFiles` to check if the hook configuration requires files (Glob hooks or Simple hooks with custom argument functions) before spawning git.

## 2026-01-21 - Skip stashing for metadata hooks
**Learning:** `git stash push` and `git stash pop` were being called unconditionally for all hooks if unstaged changes were present. This is unnecessary for hooks like `commit-msg` or `post-commit` that do not touch the working directory files. This adds significant overhead (seconds on large repos).
**Action:** Implemented an exclusion list for stashing. `commit-msg`, `prepare-commit-msg`, and `post-*` hooks now skip the stashing step.

## 2026-01-21 - Use spawn for git operations
**Learning:** `child_process.exec` spawns a shell, which adds overhead and requires careful string escaping. `child_process.spawn` is faster (no shell) and safer (array arguments).
**Action:** Refactored `src/utils/git.ts` to use `spawn` instead of `exec`.

## 2026-01-21 - Lazy load heavy dependencies
**Learning:** Top-level imports of libraries like `micromatch` impact startup time for all CLI commands, even those that don't use them (e.g., `init`, `install`).
**Action:** Moved `micromatch` import to a dynamic `await import()` inside `resolveScriptsToRun`, so it's only loaded when glob matching is actually performed.

## 2026-01-21 - Avoid shell:true for scripts with args
**Learning:** `spawn` with `shell: true` adds overhead and introduces argument parsing ambiguity. Passing arguments directly to `spawn('npm', ['run', script, ...args], { shell: false })` works reliably and avoids the shell process.
**Action:** Refactored `executeScript` to accept an `Executable` object with split args, allowing `shell: false` for the common case of glob hooks.

## 2026-01-21 - Avoid double git scan for stashing
**Learning:** `git stash push` performs a status check internally and exits quickly if there are no changes. Checking `git status` explicitly before calling `stash` results in two scans of the working directory when changes are present, and offers negligible benefit when clean.
**Action:** Removed `hasUnstagedChanges` check and relied on the return value of `stashPushKeepIndex` (which checks exit code/output of `git stash push`) to determine if stashing occurred.

## 2026-01-21 - Optimize pre-commit status check
**Learning:** `git status --porcelain` can be slow on large repositories. For glob-based pre-commit hooks, we often only care about changes to the files we processed.
**Action:** Updated `runHook` to pass the list of matched files to `getChangedFiles`, restricting the git status check to only relevant files.
