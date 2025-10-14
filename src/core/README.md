# Core Module

This directory houses the central, most critical logic for `ts-git-hooks`. The modules here are responsible for the "heavy lifting" and are orchestrated by the handlers in `/src/commands`.

## Responsibilities

The core module is responsible for abstracting the main business logic of the application. This includes:

-   **Configuration Loading**: Finding, reading, and parsing the `git-hooks.config.ts` file. This may involve a `config-loader.ts` that safely `require()`s the config file.
-   **Script Execution**: Managing the execution of npm scripts. A key component here will be a `runner.ts` module that can take a list of script names and run them in parallel. It will need to handle success and failure cases for all scripts.
-   **Hook Management**: Logic for creating the content of the actual git hook files (the shell scripts that go into `.git/hooks/`). A `hook-template.ts` might exist to generate the script content.

## File Structure (Conceptual)

-   `config-loader.ts`: Exports a function, `loadConfig()`, that finds `git-hooks.config.ts` in the project root, loads it, and returns the configuration object. It should handle cases where the file doesn't exist.
-   `runner.ts`: Exports a function, `runScripts(scripts: string[])`, that takes an array of npm script names. It uses Node.js's `child_process` module (specifically `spawn` or `exec`) to run the scripts in parallel (e.g., `npm run <script>`). It should return a promise that resolves when all scripts succeed and rejects if any script fails. This is where a library like `npm-run-all` would have been used.
-   `installer.ts`: Exports functions like `createHook(hookName: string)` and `removeHook(hookName: string)`. These would be used by the `install` and `uninstall` commands to manipulate files in the `.git/hooks` directory. It would generate a shell script that executes `npx ts-git-hooks run <hookName>`.

Separating this logic from the command handlers allows for easier unit testing of the core functionality. For example, we can test the `runner.ts` module with mock scripts without needing to interact with the file system or a full CLI.