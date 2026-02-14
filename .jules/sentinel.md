## 2025-05-15 - Command Injection in Git Hook Execution
**Vulnerability:** Command injection was possible when matched files were interpolated into a shell command string using `JSON.stringify`. A file named `$(touch EXPLOITED)` would result in command execution.
**Learning:** `JSON.stringify` does not provide safe quoting for shell commands, especially when using `shell: true` in Node.js `spawn`. Naive command parsers also fail on complex quoted arguments.
**Prevention:** Use established libraries like `shell-quote` to parse and quote command arguments. Prefer `shell: false` whenever possible. When `shell: true` is necessary, use `quote()` from `shell-quote` to safely interpolate variables into the command string.

## 2025-05-16 - Syntax and Code Injection in Generated Type Definitions
**Vulnerability:** Script names from `package.json` were directly interpolated into a generated `.d.ts` file. A script named `"; console.log('exploited');//` could result in syntax breakage or code execution when the file is analyzed or imported.
**Learning:** Even "metadata" like script names from `package.json` should be treated as untrusted input when used to generate code or type definitions.
**Prevention:** Use `JSON.stringify()` to safely escape strings that will be used as string literals in generated JavaScript or TypeScript files.
