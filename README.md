# ts-git-hooks

TypeScript-first, type-safe Git hooks manager.

[English](README.md) | [日本語](README.ja.md)

## Why ts-git-hooks?

-   **Type-safe**: Auto-completion for your `package.json` scripts.
-   **Flexible Config**: Use glob patterns for file-based hooks (`pre-commit`) or simple scripts for general hooks (`pre-push`).
-   **TypeScript First**: Write your config in `.ts` with full IDE support.
-   **Minimal Dependencies**: `ts-git-hooks` uses only 3 lightweight, well-maintained dependencies for essential functionality.

## Requirements

-   **Node.js**: v22.6.0 or higher (for native TypeScript support).
-   **Git**: Installed and available in your PATH.

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

> **Why is glob-based targeting limited to `pre-commit`?**
>
> `pre-commit` is the only Git hook where the changed-file context is a single, canonical list — the staged file set (`git diff --cached --name-only`). Other hooks either have no natural file-list context (`commit-msg`, `pre-rebase`, `pre-auto-gc`), or expose ref pairs from which "changed files" must be derived by the project's own definition (`post-checkout`, `post-merge`, `post-rewrite`, `pre-push`). Rather than pick a default and surprise users, `ts-git-hooks` only enables glob targeting where the file list is unambiguous. For project-wide tools on other hooks, use the simple-script form below.

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

#### Quoting files when using shell operators

If `argsFn` returns a string containing shell operators (`&&`, `||`, `;`, `|`, redirects), `ts-git-hooks` runs it through a shell. Wrap file paths with the `quote` helper so filenames containing spaces or shell metacharacters cannot inject shell syntax.

```ts
import type { TSGitHookConfig } from 'ts-git-hooks';
import { quote } from 'ts-git-hooks';

export const config: TSGitHookConfig<"lint"> = {
  'pre-commit': {
    '*.ts': ['lint', (files) => `lint ${quote(files)} && echo done`],
  },
};
```

When `argsFn` returns a string without shell operators (the common case), the result is parsed and passed as discrete arguments — no shell, no quoting needed.

## Supported Hooks

All standard git hooks are supported. Both camelCase (`preCommit`) and kebab-case (`pre-commit`) are supported in the configuration file.

## CLI Commands

-   `npx ts-git-hooks init`: Creates a default configuration file and syncs script types.
-   `npx ts-git-hooks sync`: Updates script type definitions from `package.json`.
-   `npx ts-git-hooks install`: Installs the hooks into your `.git/hooks` directory.
-   `npx ts-git-hooks uninstall`: Removes the hooks.
-   `npx ts-git-hooks list`: Lists the configured hooks and scripts.
-   `npx ts-git-hooks verify <hook>`: Verifies the configuration for a hook and shows which commands would be executed.
-   `npx ts-git-hooks run <hook>`: Run the scripts for a specific hook (for internal use).


## How It Works

-   For glob-based configs, scripts run in parallel for each matching pattern by default.
-   For direct script configs, scripts in an array run in parallel by default.
-   If any script fails, the hook fails, and the git operation is aborted.

## Sequential Execution

By default, `ts-git-hooks` runs multiple scripts in parallel for better performance. However, if you have multiple tools that modify the same files (e.g., `eslint --fix` and `prettier --write`), running them in parallel might cause race conditions or file conflicts.

You can force scripts to run sequentially either globally or for specific hooks:

### Global Sequential Execution

```ts
export const config: TSGitHookConfig = {
  sequential: true, // All hooks will run scripts sequentially
  'pre-commit': {
    '*.ts': ['eslint --fix', 'prettier --write'],
  },
};
```

### Per-Hook Sequential Execution

```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    sequential: true, // Only pre-commit scripts will run sequentially
    config: {
      '*.ts': ['eslint --fix', 'prettier --write'],
    },
  },
};
```

## Tips & Troubleshooting

### Handling "No files processed" (Biome, ESLint, etc.)

Some tools like **Biome** or **ESLint** may exit with a non-zero code if they are passed files that are eventually ignored by their own configuration (e.g., `biome.json`). To prevent this from failing your git hook, use the appropriate flag:

- **Biome**: Use `--no-errors-on-unmatched`.
- **ESLint**: Use `--no-error-on-unmatched-pattern`.

## License

MIT
