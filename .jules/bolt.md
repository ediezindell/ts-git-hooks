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

## 2026-02-07 - Optimize unstaged changes check
**Learning:** `git diff --name-only` followed by output parsing is slower and more memory-intensive than `git diff --quiet`. `--quiet` allows git to exit early as soon as it finds a single difference, and avoids all string capture/decoding overhead. Also, accumulating `execGit` output in an array before joining is significantly faster than repeated string concatenation for large git outputs.
**Action:** Implemented `execGitStatus` to use `stdio: 'ignore'` and return only the exit code. Refactored `hasUnstagedChanges` to use `git diff --quiet`. Optimized `execGit` to use chunk accumulation.

## 2026-02-12 - Optimize null-separated list parsing
**Learning:** `split("\0").filter(Boolean)` creates a full intermediate array and then performs a full O(N) pass for filtering. For large git outputs (e.g., thousands of files), a manual loop using `indexOf` and `substring` is ~3x faster and significantly more memory-efficient by avoiding the extra array allocation and filter pass.
**Action:** Refactored `parseNullSeparatedList` in `src/utils/string.ts` to use a manual `while` loop with `indexOf`.

## 2026-02-12 - Algorithmic optimization for command grouping
**Learning:** Grouping patterns by command using `array.find()` with structural comparison leads to O(N²) complexity (where N is the number of patterns). While N is often small, this adds unnecessary overhead. Using a `Map` with stringified command keys (using a `WeakMap` for stable function-to-ID mapping) reduces this to O(N).
**Action:** Refactored `resolveScriptsToRun` in `src/core/runner.ts` to use `Map` for command grouping and lookups.

## 2026-02-14 - Optimize redundant directory creation in file evacuation
**Learning:** During stashing of untracked files (`evacuateFiles`) and their restoration (`restoreFiles`), `mkdir({ recursive: true })` was being called for every single file. For repositories with many untracked files in the same directory, this results in numerous redundant and expensive syscalls.
**Action:** Implemented a `Set`-based cache for created directory paths within `evacuateFiles` and `restoreFiles` to ensure `mkdir` is called at most once per unique directory.

## 2026-02-14 - Efficient git output collection with Buffer
**Learning:** Collecting `git` output by decoding chunks into strings using `StringDecoder` and then joining them is less efficient than collecting raw `Buffer` chunks and using `Buffer.concat().toString()`. The latter avoids multiple intermediate string allocations and redundant encoding passes for every chunk. Also, decoding `stderr` is unnecessary on the success path.
**Action:** Refactored `execGit` in `src/utils/git.ts` to use `Buffer` accumulation and deferred decoding.

## 2026-02-14 - Parallelize git checks and memoize jiti
**Learning:** Sequential await calls for `getUntrackedFiles` and `hasUnstagedChanges` in `runHook` add unnecessary latency. Since both are read-only operations on the git index/worktree, they can be safely parallelized. Additionally, re-initializing `jiti` on every `loadConfig` call adds overhead, especially visible during test execution.
**Action:** Parallelized git status checks in `src/core/runner.ts` and memoized the `jiti` instance in `src/core/config.ts`.

## 2026-02-14 - Parallelize stashing and restoration
**Learning:** Stashing tracked changes (`git stash push`) and evacuating untracked files (physical backup) are independent operations that work on disjoint sets of files. Running them sequentially in `runHook` add unnecessary latency to the hook critical path. Similarly, restoring them in `safeRestore` can be parallelized, which also allows both restoration attempts to proceed even if one fails (e.g., due to stash conflicts).
**Action:** Parallelized stashing and restoration operations in `src/core/runner.ts` using `Promise.all` and improved error collection in `safeRestore`.

## 2026-02-07 - Further parallelization of initial git checks
**Learning:** Starting `getUntrackedFiles` and `hasUnstagedChanges` early, in parallel with `getStagedFiles` and `resolveScriptsToRun`, further reduces the critical path latency of the hook execution. This is especially effective because `getStagedFiles` and the other status checks are independent and often bottlenecked by process spawning overhead.
**Action:** Refactored `runHook` in `src/core/runner.ts` to start all three git status operations at the beginning of the function using `Promise.all`.

## 2026-02-08 - Parallel file operations for backup/restore
**Learning:** `evacuateFiles` and `restoreFiles` were performing file I/O operations (rename, mkdir) sequentially. For operations involving many files, this is I/O bound. Parallelizing these operations using `Promise.all` significantly reduces the time taken to stash and restore untracked files, which is critical for hook performance during complex git states.
**Action:** Refactored `evacuateFiles` to batch directory creation and parallelize file renames. Refactored `restoreFiles` to process directory entries in parallel while safely managing `mkdir` concurrency with a shared promise cache.

## 2026-02-08 - Optimize combined git status checks

**Learning:** For hooks that require stashing (like `pre-commit`), calling `getStagedFiles`, `getUntrackedFiles`, and `hasUnstagedChanges` separately resulted in 3 process spawns. Even when parallelized, the overhead of multiple `spawn` calls is significant (~50-100ms). Using `git status --porcelain=v1 -z` allows retrieving all this information in a single process spawn, significantly reducing latency.

**Action:** Implemented `getGitStatus` in `src/utils/git.ts` and updated `runHook` to use it when stashing is needed.



## 2026-02-08 - Secondary performance and robustness improvements



**Learning:** Minor optimizations across the codebase contribute to overall snappiness. Memoizing `loadConfig` in memory benefits repeated calls in test environments. Improving signal handler removal ensures cleaner resource management. Avoiding redundant string conversions in the `execGit` error path slightly reduces memory pressure during failures.



**Action:** Implemented in-memory memoization for `loadConfig`, switched to `process.off` for precise signal handler removal, and optimized the `execGit` error path.







## 2026-02-08 - Micro-optimizations for runner and installer







**Learning:** Reducing redundant work in hot paths further improves performance. Skipping the second `micromatch` pass when only one pattern exists saves processing time. Parallelizing hook installation speeds up the `install` command. Simple string checks (`includes`) are faster than regex when used for presence checks.







**Action:** Optimized `resolveScriptsToRun` to skip redundant matching, parallelized `install` hook writing, and replaced regex with `includes` in `kebabToCamel` and `parseSimpleCommand`.















## 2026-02-08 - Buffer-based git processing and pre-computed keys















**Learning:** Decoding large git outputs into UTF-8 strings before parsing is expensive in terms of both CPU and memory. Processing raw `Buffer` data directly using `Buffer.indexOf(0)` and only decoding individual filenames is significantly more efficient for repositories with many files. Additionally, pre-computing command keys in the pattern loop avoids redundant computations during grouping.















**Action:** Implemented `execGitBuffer` and `parseNullSeparatedBuffer` to process raw binary data. Refactored `resolveScriptsToRun` to pre-calculate command keys. Optimized `getGitStatus` to parse `Buffer` directly, avoiding all intermediate string allocations.

## 2026-02-08 - Parallel initialization and fully lazy loading
**Learning:** The initial phase of `runHook` involves two main IO operations: loading the configuration (which requires TypeScript compilation/loading via `jiti`) and checking git status (spawning a process). Previously, these were sequential. By parallelizing them (speculative execution of git status for hooks that typically need it, like `pre-commit`), we hide the latency of one behind the other.
**Action:** Parallelized `loadConfig` and `getGitStatus` in `runHook`.

**Learning:** `jiti` was being imported at the top level of `src/core/config.ts`, causing it to be loaded even when the configuration file doesn't exist or isn't needed (e.g. `init` command).
**Action:** Moved `jiti` import inside `loadConfig` and guarded it with a file existence check using `fs.stat` (via `fileExists`), ensuring zero overhead when unconfigured.

## 2026-02-08 - REJECTED: Direct script execution bypass
**Context:** Bypassing `npm run` (or `pnpm`/`yarn`) to directly execute binaries in `node_modules/.bin` would save ~200-500ms per script execution by avoiding the package manager's startup overhead.
**Decision:** Rejected. While faster, this breaks the fundamental contract of `npm scripts`. It bypasses lifecycle hooks, environment variable setup (`npm_config_*`, `PATH` modifications), and package manager-specific behaviors (like `pnpm`'s strict hoisting or `yarn`'s PnP). Maintaining full compatibility with the Node.js ecosystem is prioritized over raw speed in this case.




























