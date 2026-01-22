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

## 2026-01-22 - Filter deleted files from staged files
**Learning:** `git diff --cached --name-only` includes deleted files. Passing these to tools (e.g. linters) causes failures or unnecessary processing overhead.
**Action:** Added `--diff-filter=ACMR` to `getStagedFiles` to only include Added, Copied, Modified, and Renamed files, excluding Deleted (D) ones.

## 2026-01-22 - Lazy load CLI commands
**Learning:** Top-level imports in the CLI entry point load all command modules (and their dependencies) at startup, even if only one command is executed. This added ~30ms overhead.
**Action:** Replaced static imports with `await import()` inside the `switch` statement in `src/cli/index.ts` to only load the required command module.

## 2026-01-22 - Optimize git output decoding
**Learning:** Concatenating `Buffer.toString()` chunks (e.g., `stdout += data.toString()`) is unsafe for split multi-byte characters and slower than `StringDecoder`. `StringDecoder` correctly handles split characters and is ~15% faster for large outputs.
**Action:** Refactored `src/utils/git.ts` to use `StringDecoder` for `stdout` and `stderr` processing.

## 2026-01-22 - Optimize simple commands
**Learning:** Commands in `npm run` scripts are often simple strings (e.g. "lint", "test"). Spawning a shell (`shell: true`) for these adds overhead. We can safely split simple commands (no quotes) and use `shell: false`.
**Action:** Refactored `processCommand` to split simple commands into `{ script, args }`, enabling `shell: false` execution. Also fixed a bug where arguments in glob hooks were being treated as part of the script name in the optimized path.
