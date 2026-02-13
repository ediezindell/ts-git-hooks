## 2025-05-15 - Command Injection in Git Hook Execution
**Vulnerability:** Command injection was possible when matched files were interpolated into a shell command string using `JSON.stringify`. A file named `$(touch EXPLOITED)` would result in command execution.
**Learning:** `JSON.stringify` does not provide safe quoting for shell commands, especially when using `shell: true` in Node.js `spawn`. Naive command parsers also fail on complex quoted arguments.
**Prevention:** Use established libraries like `shell-quote` to parse and quote command arguments. Prefer `shell: false` whenever possible. When `shell: true` is necessary, use `quote()` from `shell-quote` to safely interpolate variables into the command string.
