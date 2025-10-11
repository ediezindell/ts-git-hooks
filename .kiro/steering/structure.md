# Project Structure

This document outlines the file organization, naming conventions, and architectural patterns used in the `ts-git-hooks` project.

## Root Directory Organization

The root directory is organized as follows:

- **`.gemini/`**: Contains configuration for the Gemini CLI, including custom commands.
- **`.kiro/`**: Contains steering and specification documents for AI-driven development.
- **`dist/`**: (Generated) Contains the compiled JavaScript output from the TypeScript source.
- **`node_modules/`**: Contains all project dependencies.
- **`src/`**: Contains all the TypeScript source code.
- **`package.json`**: Defines project metadata, dependencies, and scripts.
- **`tsconfig.json`**: TypeScript compiler configuration.
- **`biome.json`**: Configuration for the Biome linter and formatter.
- **`README.md`**: The main project documentation.

## `src` Directory Structure

The `src` directory is the heart of the application and is structured by feature/domain:

- **`src/cli/`**: Contains the main entry point for the command-line interface (`index.ts`) and its associated tests. This part is responsible for parsing command-line arguments and invoking the appropriate commands.
- **`src/commands/`**: Each file in this directory corresponds to a CLI command (e.g., `init.ts`, `install.ts`). It contains the specific logic for each command.
- **`src/core/`**: Holds the central logic of the application. 
  - `config.ts`: Responsible for loading and parsing the `ts-git-hooks.config.ts` file.
  - `runner.ts`: The core script runner that executes the configured hook commands.
- **`src/types.ts`**: Defines the core TypeScript types and interfaces used throughout the application, including the main `TSGitHookConfig` type.
- **`src/utils/`**: Contains utility functions that are used across different parts of the application, such as Git-related helpers (`git.ts`).

## Code Organization and Naming Conventions

- **File Naming**: Files are named using kebab-case (e.g., `runner.ts`, `install.test.ts`).
- **Testing**: Test files are co-located with the source files they are testing and use the `.test.ts` suffix (e.g., `init.ts` and `init.test.ts`).
- **Modularity**: Each file and module has a clear and single responsibility. For example, `commands/install.ts` only contains the logic for the `install` command.

## Key Architectural Principles

- **Separation of Concerns**: The code is divided into distinct layers: the CLI layer for user interaction (`cli`, `commands`), the business logic layer (`core`), and shared utilities (`utils`).
- **Type Safety**: TypeScript is used to enforce type safety not only in the application code but also in the user-facing configuration, which is a core principle of the project.
- **Co-location of Tests**: Tests are kept close to the implementation to make them easy to find and maintain.
