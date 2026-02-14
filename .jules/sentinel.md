## 2025-05-15 - Command Injection in Git Hook Execution
**Vulnerability:** Command injection was possible when matched files were interpolated into a shell command string using `JSON.stringify`. A file named `$(touch EXPLOITED)` would result in command execution.
**Learning:** `JSON.stringify` does not provide safe quoting for shell commands, especially when using `shell: true` in Node.js `spawn`. Naive command parsers also fail on complex quoted arguments.
**Prevention:** Use established libraries like `shell-quote` to parse and quote command arguments. Prefer `shell: false` whenever possible. When `shell: true` is necessary, use `quote()` from `shell-quote` to safely interpolate variables into the command string.

## 2025-05-16 - Syntax and Code Injection in Generated Type Definitions
**Vulnerability:** Script names from `package.json` were directly interpolated into a generated `.d.ts` file. A script named `"; console.log('exploited');//` could result in syntax breakage or code execution when the file is analyzed or imported.
**Learning:** Even "metadata" like script names from `package.json` should be treated as untrusted input when used to generate code or type definitions.
**Prevention:** Use `JSON.stringify()` to safely escape strings that will be used as string literals in generated JavaScript or TypeScript files.

## 2025-05-17 - Command Injection and Path Traversal via Git Hook Names
**Vulnerability:** Git hook names (derived from configuration keys) were used directly as filenames for hook installation and interpolated into shell scripts. Malicious keys like `pre-commit; touch exploited` or `../../../malicious-file` could lead to command execution or path traversal.
**Learning:** Configuration keys are untrusted input, even if they are expected to match a specific type (like `GitHook`). Validation must occur at runtime before using these keys in security-sensitive operations like filesystem access or shell script generation.
**Prevention:** Validate hook names against a strict allowlist or a safe regex (e.g., `/^[a-z0-9-]+$/`) before using them in file operations or shell scripts.

## 2025-05-18 - Symlink Traversal during File Restoration
**Vulnerability:** The `restoreFiles` function used `stat()` to check if a destination path was a directory. If an attacker created a symlink to a sensitive directory (like `/etc`), `stat()` would follow it, and the restoration process would move files into the symlink's target.
**Learning:** `stat()` follows symbolic links, while `lstat()` does not. When performing recursive directory operations, especially in potentially untrusted working directories, `lstat()` should be used to avoid symlink traversal attacks.
**Prevention:** Use `lstat()` when checking file types during recursive directory traversal or restoration processes to ensure you are acting on the literal path and not following symlinks to unintended locations.
