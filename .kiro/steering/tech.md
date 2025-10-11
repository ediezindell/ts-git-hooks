# Technology Stack

This document outlines the technology stack, development environment, and architectural decisions for the `ts-git-hooks` project.

## Architecture

- **Language**: TypeScript
- **Runtime**: Node.js
- **Package Manager**: npm
- **Core Logic**: The tool is a CLI application built to be executed by `npx` or as a binary. It reads a local `ts-git-hooks.config.ts` file, dynamically transpiles it using `jiti`, and then executes the configured `package.json` scripts based on the git hook that was triggered.
- **Modularity**: The codebase is split into `cli`, `core`, `commands`, and `utils` to separate concerns.

## Development Environment

- **TypeScript**: The project is written entirely in TypeScript. The configuration (`tsconfig.json`) is set to target `ES2020` and `commonjs` modules.
- **Testing**: `vitest` is used for running unit and integration tests.
- **Linting & Formatting**: `biome` is used for both linting and formatting to ensure code consistency.
- **Build Tool**: `tsc` (the TypeScript compiler) is used to build the project into JavaScript for distribution.

## Common Commands

The following scripts are defined in `package.json` and are central to the development workflow:

- `npm run test`: Executes the test suite using `vitest`.
- `npm run lint`: Lints the codebase with `biome`.
- `npm run format`: Formats the code using `biome`.
- `npm run build`: Compiles the TypeScript source code into JavaScript in the `dist` directory.

## Dependencies

### Production Dependencies
- **jiti**: Used for just-in-time TypeScript compilation of the configuration file.
- **micromatch**: Used for glob pattern matching to filter files for specific scripts.

### Development Dependencies
- **@biomejs/biome**: For code linting and formatting.
- **@types/node**: Provides TypeScript type definitions for Node.js APIs.
- **npm-run-all**: Used for running multiple npm scripts.
- **typescript**: The TypeScript compiler.
- **vitest**: A testing framework.
