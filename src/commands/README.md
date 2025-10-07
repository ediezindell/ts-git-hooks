# Commands Module

This directory contains the implementation for each of the CLI subcommands supported by `ts-git-hooks`. Each file in this directory should correspond to a single command and export a primary function that executes the command's logic.

## Responsibilities

-   Each file implements the logic for one specific command (e.g., `install`, `uninstall`, `list`, `init`).
-   The functions in these files are called by the CLI handler in `/src/cli`.
-   They interact with the `/src/core` module to perform complex tasks like reading configuration or running scripts.
-   They may use helpers from `/src/utils` for tasks like file I/O or logging.

## File Structure

-   `list.ts`: Contains the `list()` function. It will use the `config-loader` from `/core` to fetch the configuration and then pretty-print it to the console.
-   `init.ts`: Contains the `init()` function. It will create a template `ts-git-hooks.config.ts` file in the user's project root.
-   `install.ts`: Contains the `install()` function. It will read the configuration and create the necessary hook scripts in the `.git/hooks/` directory. These scripts will be simple wrappers that call `npx ts-git-hooks run <hook-name>`.
-   `uninstall.ts`: Contains the `uninstall()` function. It will remove the hook scripts created by the `install` command.
-   `run.ts`: Contains the `run()` function. This is a special internal command called by the git hook scripts themselves. It takes a hook name (e.g., `pre-commit`) as an argument, loads the config, and executes the associated scripts using the parallel runner from `/core`.

By isolating each command's logic, we make the system easier to debug and test. For instance, `list.ts` can be tested independently of `install.ts`.