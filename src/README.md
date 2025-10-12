# Source Code Structure

This directory contains the core source code for `ts-git-hooks`. The code is organized into the following modules, each with a specific responsibility.

## Directories

-   **/cli**: Contains the command-line interface (CLI) entry point. This module is responsible for parsing command-line arguments (`install`, `list`, etc.) and delegating tasks to the appropriate command handlers.
-   **/commands**: Implements the logic for each individual CLI command (e.g., `list.ts`, `init.ts`). Each file in this directory corresponds to a specific command.
-   **/core**: Houses the central logic of the application. This includes loading the `ts-git-hooks.config.ts` configuration, finding and executing the corresponding npm scripts, and managing the hook execution process (e.g., parallel execution).
-   **/utils**: Provides common utility functions that are shared across different modules. This can include things like file system wrappers, logging utilities, or color formatting for console output.
-   **/types.ts**: Defines the TypeScript types and interfaces used throughout the project, such as the structure of the configuration object (`TSGitHookConfig`).

This modular structure is designed to separate concerns, making the codebase easier to understand, maintain, and test.