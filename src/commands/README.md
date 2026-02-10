# Commands Module

This directory contains the implementation for each of the CLI subcommands supported by `ts-git-hooks`. Each file in this directory should correspond to a single command and export a primary function that executes the command's logic.

## Responsibilities

-   Each file implements the logic for one specific command (e.g., `install`, `uninstall`, `list`, `init`).
-   The functions in these files are called by the CLI handler in `/src/cli`.
-   They interact with the `/src/core` module to perform complex tasks like reading configuration or running scripts.
-   They may use helpers from `/src/utils` for tasks like file I/O or logging.

## File Structure

-   `list.ts`: Contains the `list()` function. It uses the `loadConfig` from `/core` to fetch the configuration and then pretty-prints it to the console.
-   `init.ts`: Contains the `init()` function. It creates a template `git-hooks.config.ts` file and a `git-hooks.d.ts` file in the project root.
-   `install.ts`: Contains the `install()` function. It creates the necessary hook scripts in the `.git/hooks/` directory. These scripts call `ts-git-hooks run <hook-name>`.
-   `uninstall.ts`: Contains the `uninstall()` function. It removes the hook scripts created by the `install` command.
-   `sync.ts`: Contains the `sync()` function. It updates the `git-hooks.d.ts` file with script names from `package.json`.
-   `verify.ts`: Contains the `verify()` function. It allows users to see what commands would be executed for a given hook based on the current staged files without actually running them.

By isolating each command's logic, we make the system easier to debug and test. For instance, `list.ts` can be tested independently of `install.ts`.