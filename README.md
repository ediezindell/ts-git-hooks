# ts-git-hooks

TypeScript-first, type-safe Git hooks manager.

## Why ts-git-hooks?

-   **Type-safe**: Auto-completion for your `package.json` scripts.
-   **Flexible Config**: Use glob patterns for file-based hooks (`pre-commit`) or simple scripts for general hooks (`pre-push`).
-   **TypeScript First**: Write your config in `.ts` with full IDE support.

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

This will generate a default configuration that works with a standard `package.json` scripts section.

### 2. Install hooks

```bash
npx ts-git-hooks install
```

That's it! Your git hooks are now active.

## Examples

### Glob-based Config for `pre-commit`

This configuration lints staged `.ts` files and formats staged markdown and json files.

```ts
// git-hooks.config.ts
export const config: TSGitHookConfig<"lint" | "format"> = {
  'pre-commit': {
    '*.ts': 'lint',
    '*.{md,json}': 'format',
  }
};
```

### Direct Script Config for `pre-push`

This configuration runs the `test` and `build` scripts before any push.

```ts
// git-hooks.config.ts
export const config: TSGitHookConfig<"test" | "build"> = {
  'pre-push': ['test', 'build']
};
```

### Integration with `package.json`

`ts-git-hooks` works by running your existing npm scripts. Here is an example `package.json` that would work with the configurations above.

```json
// package.json
{
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run",
    "build": "tsc"
  }
}
```

## Supported Hooks

All standard git hooks are supported.

## CLI Commands

-   `npx ts-git-hooks init`: Creates a default configuration file.
-   `npx ts-git-hooks install`: Installs the hooks into your `.git/hooks` directory.
-   `npx ts-git-hooks uninstall`: Removes the hooks.
-   `npx ts-git-hooks list`: Lists the configured hooks and scripts.

## How It Works

-   For glob-based configs, scripts run in parallel for each matching pattern.
-   For direct script configs, scripts in an array run in parallel.
-   If any script fails, the hook fails, and the git operation is aborted.

## License

MIT