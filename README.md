# ts-git-hooks

TypeScript-first, type-safe Git hooks manager.

[English](README.md) | [日本語](README.ja.md)

## Why ts-git-hooks?

-   **Type-safe**: Auto-completion for your `package.json` scripts.
-   **Flexible Config**: Use glob patterns for file-based hooks (`pre-commit`) or simple scripts for general hooks (`pre-push`).
-   **TypeScript First**: Write your config in `.ts` with full IDE support.
-   **Zero Dependencies**: `ts-git-hooks` is a standalone tool with no runtime dependencies.

## Core Concepts

`ts-git-hooks` is built on a few key principles to make managing your git hooks simple and robust.

1.  **Type-Safe Scripts:** Leverage TypeScript for full autocompletion and compile-time safety for your npm script names right from your `package.json`. No more typos or guesswork.

2.  **Glob-based Targeting:** Use glob patterns to precisely control which scripts run on which files. A script for `'*.ts'` will only run against staged TypeScript files.

3.  **Flexible Argument Handling:** Scripts automatically receive the list of matching **staged files** as arguments. For more complex needs, you can provide a function to format the arguments exactly as your script requires.

4.  **Optimized for npm:** The entire workflow is designed to integrate seamlessly with your existing npm scripts, acting as a powerful, type-safe orchestrator for the tools you already use.

## Installation

```bash
npm install -D ts-git-hooks
```

## Quick Start

### 1. Create a config file

Run the init command to create a `git-hooks.config.ts` file in your project root:

```bash
npx ts-git-hooks init
```

This will generate a default configuration and a `git-hooks.d.ts` file with type definitions for your `package.json` scripts.

### 2. Install hooks

```bash
npx ts-git-hooks install
```

That's it! Your git hooks are now active.

## Configuration

The `git-hooks.config.ts` file is the heart of `ts-git-hooks`. It's a TypeScript file where you define which scripts to run for each git hook.

There are two main types of hook configurations:

### 1. Glob-based Hooks (`pre-commit`)

For hooks that operate on a subset of files, like `pre-commit`, you can use a glob-based configuration. The keys are glob patterns, and the values are the scripts to run on files matching those patterns.

```ts
// git-hooks.config.ts
import type { TSGitHookConfig } from 'ts-git-hooks';

type Scripts = keyof typeof import('./package.json')['scripts'];

export const config: TSGitHookConfig<Scripts> = {
  'pre-commit': {
    '*.ts': 'lint', // run 'lint' script on staged .ts files
    '*.{md,json}': 'format', // run 'format' script on staged .md and .json files
  },
};
```

### 2. Simple Hooks (e.g., `pre-push`, `commit-msg`)

For hooks that run a task for the entire project, rather than specific files, you can provide a script or an array of scripts. These scripts will be run in parallel.

```ts
// git-hooks.config.ts
export const config: TSGitHookConfig<"test" | "build"> = {
  'pre-push': ['test', 'build'] // run 'test' and 'build' scripts before pushing
};
```

### Advanced: Custom Argument Formatting

By default, for glob-based hooks, the paths of the matching staged files are appended as space-separated arguments to the script. You can customize this by providing a tuple `[script, argsFn]` where `argsFn` is a function that receives the staged files and the script name and returns a string of arguments.

```ts
// git-hooks.config.ts
export const config: TSGitHookConfig<"lint"> = {
  'pre-commit': {
    '*.ts': ['lint', (files) => files.map(f => `--file ${f}`).join(' ')],
  },
};
```

## Supported Hooks

All standard git hooks are supported. Both camelCase (`preCommit`) and kebab-case (`pre-commit`) are supported in the configuration file.

## CLI Commands

-   `npx ts-git-hooks init`: Creates a default configuration file and syncs script types.
-   `npx ts-git-hooks sync`: Updates script type definitions from `package.json`.
-   `npx ts-git-hooks install`: Installs the hooks into your `.git/hooks` directory.
-   `npx ts-git-hooks uninstall`: Removes the hooks.
-   `npx ts-git-hooks list`: Lists the configured hooks and scripts.
-   `npx ts-git-hooks run <hook>`: Run the scripts for a specific hook (for internal use).


## How It Works

-   For glob-based configs, scripts run in parallel for each matching pattern.
-   For direct script configs, scripts in an array run in parallel.
-   If any script fails, the hook fails, and the git operation is aborted.

## License

MIT
