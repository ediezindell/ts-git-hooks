## 2026-01-21 - Lazy loading of staged files
**Learning:** `git diff --cached` (spawned process) was being called unconditionally for all hooks, even those that don't need file arguments (like `pre-push: npm test`). This adds ~50-100ms overhead to every hook execution.
**Action:** Implemented `shouldFetchStagedFiles` to check if the hook configuration requires files (Glob hooks or Simple hooks with custom argument functions) before spawning git.
