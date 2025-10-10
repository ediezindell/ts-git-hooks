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

### Q: What if I need sequential execution?

Create a combined script in `package.json`:

```json
{
  "scripts": {
    "pre-commit": "npm run lint && npm run format"
  }
}
```

```ts
import { TSGitHookConfig } from "ts-git-hooks";

export const config: TSGitHookConfig = {
  'pre-commit': {
    run: 'pre-commit'
  }
}
```

### Q: Can I use JavaScript instead of TypeScript?

No.

### Q: Does this work in CI?

Git hooks only run locally. In CI, run your scripts directly:

```yaml
- run: npm run lint
- run: npm run test
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

