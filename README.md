# ts-git-hooks

TypeScript-first git hooks manager with type-safe configuration.

## Why ts-git-hooks?

- Type-safe: Auto-completion for your `package.json` scripts
- Fast: Parallel execution of hooks by default
- TypeScript Config: Write your config in `.ts` with full IDE support

## Installation

```bash
npm install -D ts-git-hooks
```

## Quick Start

### 1. Create config file

Create `ts-git-hooks.config.ts` in your project root:

```ts
import { TSGitHookConfig } from "ts-git-hooks";

export const config: TSGitHookConfig = {
  'pre-commit': {
    run: ['lint', 'format']
  },
  'pre-push': {
    run: ['test', 'typecheck']
  }
}
```

or run `npx ts-git-hooks init`.

### 2. Install hooks

```bash
npx ts-git-hooks install
```

That's it! Your git hooks are ready to use.

## Configuration

### Basic Usage

```ts
import { TSGitHookConfig } from "ts-git-hooks";

export const config: TSGitHookConfig = {
  'pre-commit': {
    run: 'lint'  // Single script
  },
  'commit-msg': {
    run: ['commitlint']  // Array for multiple scripts
  },
  'pre-push': {
    run: ['test', 'build']  // Runs in parallel
  }
}
```

### Type Safety

Scripts are automatically typed from your `package.json`:

```ts
import { TSGitHookConfig } from "ts-git-hooks";

// ✅ TypeScript will autocomplete available scripts
export const config: TSGitHookConfig = {
  'pre-commit': {
    run: ['lint', 'format']  // IDE autocomplete works!
  }
}

// ❌ TypeScript error if script doesn't exist
export const config: TSGitHookConfig = {
  'pre-commit': {
    run: ['nonexistent']  // Error: "nonexistent" is not in package.json
  }
}
```

### Glob Pattern Matching

You can run scripts only for specific files using glob patterns. This is useful for tools like linters or formatters that should only run on relevant files.

```ts
import { TSGitHookConfig } from "ts-git-hooks";

export const config: TSGitHookConfig = {
  'pre-commit': {
    '*.{js,ts}': 'eslint --fix',
    '*.{css,scss}': 'stylelint --fix',
    'package.json': 'npm install',
  }
}
```
When you commit, `eslint` will only run if there are staged `.js` or `.ts` files. The staged file paths are automatically passed as arguments to the script.

### Customizing Arguments with `ArgsFn`

For more control over how arguments are passed, you can provide a function, `ArgsFn`, as the second element of a command tuple. This function receives an array of matching file paths and should return the final command string.

The type of `ArgsFn` is `(files: string[]) => string`.

**Example: Passing files with a `--files` flag**

```ts
import { TSGitHookConfig } from "ts-git-hooks";

const prettierCommand = (files: string[]) => `prettier --write --files ${files.join(' ')}`;

export const config: TSGitHookConfig = {
  'pre-commit': {
    '*.{js,ts,css}': ['prettier', prettierCommand],
  }
}
```
In this example, if `a.js` and `b.ts` are staged, the command `npm run prettier --write --files a.js b.ts` will be executed.

## Supported Hooks

All standard git hooks are supported:

- `pre-commit` (or `preCommit`)
- `commit-msg` (or `commitMsg`)
- `pre-push` (or `prePush`)
- `post-commit` (or `postCommit`)
- `pre-rebase` (or `preRebase`)
- `post-checkout` (or `postCheckout`)
- `post-merge` (or `postMerge`)
- And more...

## CLI Commands

### Install hooks

```sh
npx ts-git-hooks install
```

Sets up git hooks in `.git/hooks/`.

### Uninstall hooks

```sh
npx ts-git-hooks uninstall
```

Removes all hooks managed by ts-git-hooks.

### List configured hooks

```sh
npx ts-git-hooks list
```

Shows all configured hooks and their scripts.

## How It Works

- Scripts run in **parallel** by default for speed
- All scripts must succeed for the hook to pass
- If any script fails, the hook fails and git operation is aborted

## Example Workflow

```ts
import { TSGitHookConfig } from "ts-git-hooks";

export const config: TSGitHookConfig = {
  'pre-commit': {
    run: ['lint', 'format', 'typecheck']
  },
  'pre-push': {
    run: ['test']
  }
}
```

```json
{
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Now when you commit:
1. `lint`, `format`, and `typecheck` run in parallel
2. If all pass, commit succeeds
3. If any fail, commit is aborted

## FAQ

### Q: How do I run scripts sequentially instead of in parallel?
By default, scripts are run in parallel for maximum speed. If you need to run them in a specific order, create a combined script in your `package.json`.

**`package.json`**
```json
{
  "scripts": {
    "lint-and-format": "npm run lint && npm run format"
  }
}
```

**`ts-git-hooks.config.ts`**
```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    run: 'lint-and-format'
  }
}
```

### Q: How can I automatically format my code on commit?
Use a glob pattern to run your formatter only on staged files. The hook will automatically stage any changes made by the formatter.

```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    '*.{js,ts,css,md}': 'prettier --write'
  }
}
```
Now, when you `git commit`, any staged `.ts` or `.css` files will be automatically formatted by Prettier.

### Q: How do I run a script only on files in a specific directory?
You can use more specific glob patterns to target directories. For example, to run tests only for staged files within the `src/` directory:

```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    'src/**/*.{js,ts}': 'vitest related'
  }
}
```

### Q: What's the difference between `run` and a glob pattern?
- **`run`**: Scripts listed under `run` are **unconditional**. They always execute when the hook is triggered. If there are staged files, their paths will be passed as arguments.
- **Glob Pattern (`'*.ts'`)**: Scripts under a glob pattern are **conditional**. They only execute if at least one staged file matches the pattern. Only the paths of the matching files are passed as arguments.

**Example Scenario:**
You want to always run a `lint` script on all staged files, but only run `tsc` if TypeScript files have changed.

```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    // Always runs on all staged files
    run: 'lint',
    // Only runs if staged files include at least one .ts file
    '*.ts': 'tsc --noEmit'
  }
}
```

### Q: Can I use this tool with plain JavaScript?
No, this tool is designed for TypeScript projects to leverage type-safety in configuration.

### Q: Does this work in a CI/CD environment?
Git hooks are designed for local development and are not executed in most CI/CD environments. You should run your validation scripts (linting, testing, etc.) as explicit steps in your CI pipeline.

**`.github/workflows/ci.yml`**
```yaml
- name: Run Linter
  run: npm run lint

- name: Run Tests
  run: npm run test
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

