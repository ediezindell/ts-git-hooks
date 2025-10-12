# Utils Module

This directory provides a collection of shared, reusable utility functions that are used by various parts of the `ts-git-hooks` application. The goal is to avoid code duplication and abstract common operations into well-defined, testable functions.

## Responsibilities

Utilities in this module might include:

-   **File System Wrappers**: Functions that wrap Node.js's `fs` module to provide promise-based or more robust file operations (e.g., `readFile`, `writeFile`, `exists`). This can help standardize file handling across the app.
-   **Logging**: A simple logging utility (`logger.ts`) that standardizes console output. It could provide functions like `log.info()`, `log.error()`, `log.warn()`, and `log.success()`, perhaps with color-coded output using libraries like `chalk` (if available) or raw ANSI escape codes.
-   **Path Resolvers**: Functions to reliably resolve paths, such as finding the project's root directory (where `package.json` is located).

## File Structure (Conceptual)

-   `fs.ts`: Exports promise-based wrappers around common `fs` functions.
    -   `export async function fileExists(path: string): Promise<boolean>`
    -   `export async function writeFile(path: string, content: string): Promise<void>`
-   `logger.ts`: Exports a logger object for consistent console output.
    -   `export const logger = { info: (msg) => console.log(msg), error: (msg) => console.error(msg) };`
-   `paths.ts`: Exports constants or functions for important paths.
    -   `export const projectRoot = findProjectRoot();`

By centralizing these helpers, we make the core logic in `/core` and `/commands` cleaner and more focused on their primary responsibilities. It also allows for isolated testing of these utility functions.