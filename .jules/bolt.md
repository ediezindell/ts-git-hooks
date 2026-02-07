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
