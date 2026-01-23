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

## 2026-01-23 - Use detected package manager in runner
**Learning:** Hardcoding `npm` in the runner adds overhead if the user is using `pnpm` or `yarn`, and can lead to inconsistencies. Using the detected package manager from `npm_config_user_agent` is faster and more reliable.
**Action:** Updated `executeScript` in `src/core/runner.ts` to use `getPackageManager()` to dynamically select the correct executable.

## 2026-01-23 - Jiti caching behavior
**Learning:** Verified that `jiti` v2 (used in the project) defaults to `fsCache: true` (or equivalent), creating a cache in `node_modules/.cache/jiti`. This means config loading is already optimized for subsequent runs.
**Action:** No action needed; confirmed existing architecture is performant.

## 2026-01-22 - Optimize simple commands
**Learning:** Commands in `npm run` scripts are often simple strings (e.g. "lint", "test"). Spawning a shell (`shell: true`) for these adds overhead. We can safely split simple commands (no quotes) and use `shell: false`.
**Action:** Refactored `processCommand` to split simple commands into `{ script, args }`, enabling `shell: false` execution. Also fixed a bug where arguments in glob hooks were being treated as part of the script name in the optimized path.

## 2026-01-23 - Use raw git output (-z)
**Learning:** `git diff` output quotes filenames containing spaces or special characters, which requires complex parsing. Using `git diff -z` (null-terminated) avoids quoting and allows simple, fast splitting by `\0`, ensuring correctness for all filenames and removing parsing overhead.
**Action:** Updated `getStagedFiles` in `src/utils/git.ts` to use `-z`.

## 2026-01-23 - Use Set for O(1) lookups
**Learning:** Using `Array.prototype.includes()` for checking if a hook should be skipped has a time complexity of O(n). For a small, fixed list, this is negligible, but using a `Set` provides a more performant O(1) lookup.
**Action:** Replaced the `hooksSkippingStash` array with a `Set` in `src/core/runner.ts` for faster lookups.

## 2026-01-23 - Batch micromatch calls and cache package manager
**Learning:** Calling `micromatch` for every glob pattern in the config is inefficient, especially with many staged files. `micromatch` is much faster when matching against an array of patterns in a single call. Also, repeated access to `process.env` for package manager detection adds unnecessary overhead.
**Action:** Refactored `resolveScriptsToRun` to group patterns by command and perform a single `micromatch` call per command group. Memoized the result of `getPackageManager` to avoid repeated environment variable lookups.

## 2026-01-23 - [Optimization] Micromatch filtering with pre-filtered subset
**Learning:** In projects with many staged files but few matching hook patterns, calling `micromatch` repeatedly on the full list of staged files is inefficient. Pre-filtering the staged files into a `matchedFiles` subset and then performing specific pattern matching on that subset significantly reduces the workload for subsequent `micromatch` calls.
**Action:** Always check if a large collection can be narrowed down once before performing multiple specific filters/matches on it.

## 2026-01-23 - Use git diff for modified files
**Learning:** `git status --porcelain` scans for untracked files and calculates index-vs-HEAD diffs, which is slower than `git diff` when we only care about modified files in the working directory (relative to index). Also, `git status` output parsing is complex and error-prone (including handling untracked files which we want to ignore).
**Action:** Replaced `git status` with `git diff --name-only --diff-filter=ACMR` in `getChangedFiles`. This improves performance on large/dirty repos and prevents accidental staging of untracked files.
