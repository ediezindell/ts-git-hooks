# ts-git-hooks

TypeScript-first git hooks manager with type-safe configuration.

## Why ts-git-hooks?

-   **Type-safe**: Auto-completion for your `package.json` scripts.
-   **Flexible Config**: Use glob patterns for file-based hooks (`pre-commit`) or simple scripts for general hooks (`pre-push`).
-   **TypeScript First**: Write your config in `.ts` with full IDE support.

## Core Concepts

`ts-git-hooks` is built on a few key principles to make managing your git hooks simple and robust.

1.  **Type-Safe Scripts:** Leverage TypeScript to get full autocompletion and compile-time validation for your npm script names right from your `package.json`. No more typos or guesswork.

2.  **Glob-based Targeting:** Use glob patterns to precisely control which scripts run on which files. A script for `'*.ts'` will only run against staged TypeScript files, and a script for `'*.css'` will only run against staged CSS files.

3.  **Flexible Argument Handling:** Scripts automatically receive the list of matching files as arguments. For more complex needs, you can provide a function to format the arguments exactly as your script requires.

4.  **Optimized for npm:** The entire workflow is designed to integrate seamlessly with your existing npm scripts, acting as a powerful, type-safe orchestrator for the tools you already use.

## Installation

```bash
npm install -D ts-git-hooks
```

## Quick Start

### 1. Create a config file

Run the init command to create a `ts-git-hooks.config.ts` file in your project root:

```bash
npx ts-git-hooks init
```

This will generate a default configuration:

```ts
// ts-git-hooks.config.ts
import type { TSGitHookConfig } from "ts-git-hooks";
import pkg from "./package.json" with { type: "json" };

export const config: TSGitHookConfig<keyof typeof pkg.scripts> = {
	// For file-based hooks like `pre-commit`, use an object with glob patterns.
	"pre-commit": {
		"*.{js,ts,jsx,tsx}": ["lint", "test"],
		"*.{md,json}": "format",
	},
	// For general hooks like `pre-push`, provide the script(s) directly.
	"pre-push": "build",
};
```

### 2. Install hooks

```bash
npx ts-git-hooks install
```

That's it! Your git hooks are now active.

## Configuration

`ts-git-hooks` supports two configuration formats depending on the nature of the git hook.

### 1. Glob-based Config (for file-dependent hooks)

For hooks that operate on a subset of files, like `pre-commit`, you should use an object where keys are glob patterns. The corresponding scripts will only run if there are staged files matching the pattern.

```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    '*.ts': 'tsc --noEmit', // Run tsc on staged .ts files
    '*.{js,css,md}': 'prettier --write', // Format other files
  }
};
```

### 2. Direct Script Config (for file-independent hooks)

For hooks that are not file-specific, like `pre-push` or `post-merge`, you can provide a script or an array of scripts directly.

```ts
export const config: TSGitHookConfig = {
  // Run a single script
  'pre-push': 'test',

  // Run multiple scripts in parallel
  'post-merge': ['npm install', 'npm run build']
};
```

### Type Safety

The generic `TSGitHookConfig<T>` type can be populated with the script names from your `package.json` to provide type-safety and auto-completion in your editor.

```ts
import type { TSGitHookConfig } from "ts-git-hooks";
import pkg from "./package.json" with { type: "json" };

type Scripts = keyof typeof pkg.scripts;

// ✅ TypeScript will autocomplete available scripts and catch typos.
export const config: TSGitHookConfig<Scripts> = {
  'pre-commit': {
    '*.ts': 'lint' // 'lint' must exist in your package.json scripts
  },
  'pre-push': 'test' // 'test' must also exist
};
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