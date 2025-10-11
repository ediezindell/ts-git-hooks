# Product Overview

`ts-git-hooks` is a TypeScript-first git hooks manager designed to provide a type-safe and efficient way to manage git hooks directly within a project's existing development workflow.

## Core Features

- **Type-Safe Configuration**: Leverages TypeScript to provide auto-completion and compile-time checks for scripts defined in `package.json`, reducing configuration errors.
- **Fast Execution**: Runs git hook scripts in parallel by default to minimize wait times and improve developer productivity.
- **TypeScript Native**: Configuration is written in a `.ts` file, allowing developers to use their existing tools and IDE features for a seamless experience.
- **Zero Dependencies**: The core runtime has zero production dependencies, keeping it lightweight.

## Target Use Case

The primary use case is for development teams using TypeScript who want to enforce code quality standards (linting, formatting, testing) automatically before commits or pushes, without the overhead of complex configuration or learning a new tool's syntax. It replaces the need for shell scripts in `.git/hooks` with a manageable, version-controlled, and type-safe system.

## Key Value Proposition

`ts-git-hooks` differentiates itself by offering:
1.  **Enhanced Developer Experience**: Type safety and auto-completion in the configuration file prevent common errors and make setup intuitive.
2.  **Performance**: Parallel script execution significantly speeds up the git hook process compared to sequential runners.
3.  **Simplicity**: Integrates with existing `package.json` scripts and uses a simple, declarative TypeScript configuration file.
