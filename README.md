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
    '*.ts': 'lint',
    '*.json': 'format'
  },
  'pre-push': {
    '*': 'test'
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
    '*.ts': 'lint'
  },
  'commit-msg': {
    '*': 'commitlint'
  },
  'pre-push': {
    '*': 'test'
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
    '*.ts': 'lint'  // IDE autocomplete works!
  }
}

// ❌ TypeScript error if script doesn't exist
export const config: TSGitHookConfig = {
  'pre-commit': {
    '*.ts': 'nonexistent'  // Error: "nonexistent" is not in package.json
  }
}
```

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

- All scripts must succeed for the hook to pass
- If any script fails, the hook fails and git operation is aborted

## Example Workflow

```ts
import { TSGitHookConfig } from "ts-git-hooks";

export const config: TSGitHookConfig = {
  'pre-commit': {
    '*.ts': 'lint',
    '*.{css,md}': 'format'
  },
  'pre-push': {
    '*': 'test'
  }
}
```

```json
{
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --check .",
    "test": "vitest run"
  }
}
```

Now when you commit:
1. If you have any staged `.ts` files, `lint` will run.
2. If you have any staged `.css` or `.md` files, `format` will run.
3. If all scripts pass, commit succeeds.
4. If any script fails, commit is aborted.

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
    '*': 'pre-commit'
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

