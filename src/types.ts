export type KebabCaseGitHook =
	| "pre-commit"
	| "prepare-commit-msg"
	| "commit-msg"
	| "post-commit"
	| "pre-rebase"
	| "post-rewrite"
	| "post-checkout"
	| "post-merge"
	| "pre-push"
	| "pre-auto-gc";

export type CamelCaseGitHook =
	| "preCommit"
	| "prepareCommitMsg"
	| "commitMsg"
	| "postCommit"
	| "preRebase"
	| "postRewrite"
	| "postCheckout"
	| "postMerge"
	| "prePush"
	| "preAutoGc";

export type GitHook = KebabCaseGitHook | CamelCaseGitHook;

/**
 * A function that takes a list of file paths and returns a command string.
 *
 * @remarks
 * If the returned string contains shell operators (`&&`, `||`, `;`, `|`,
 * redirects), the runner executes it via `shell: true`. Embed file paths
 * through {@link quote} (exported from `ts-git-hooks`) in that case to
 * prevent filenames containing shell metacharacters from being interpreted
 * as code.
 *
 * @example
 * import { quote, type ArgsFn } from 'ts-git-hooks';
 * const argsFn: ArgsFn = (files) => `lint ${quote(files)} && echo done`;
 */
export type ArgsFn = (files: string[], script: string) => string;

/**
 * A command to be executed, either a script name or a tuple of [script, argsFn].
 */
export type Command<T extends string> = T | [T, ArgsFn];

/**
 * A single script or an array of scripts.
 */
export type Script<T extends string> = Command<T> | Command<T>[];

/**
 * Hooks that run scripts against a list of files, configured with glob patterns.
 * This is a subset of `GitHook`.
 */
export type FileDependentHook = Extract<KebabCaseGitHook, "pre-commit">;

/**
 * Hooks that run scripts unconditionally, not against specific files.
 */
export type FileIndependentHook = Exclude<KebabCaseGitHook, FileDependentHook>;

/**
 * Configuration for file-dependent hooks (e.g., `pre-commit`).
 * Maps glob patterns to scripts.
 * @example { '*.ts': 'tsc' }
 */
export type GlobHookConfig<T extends string> = Record<string, Script<T>>;

/**
 * Configuration for file-independent hooks (e.g., `pre-push`).
 * A single script or an array of scripts.
 * @example 'test' or ['test', 'build']
 */
export type SimpleHookConfig<T extends string> = Script<T>;

/**
 * Options that apply at the top level of `TSGitHookConfig`.
 *
 * `replayFormatter` lives here (and not in `PerHookOptions`) because the runtime
 * only consults the top-level value. Allowing it per-hook would compile but
 * silently no-op at runtime, so it is intentionally excluded from `PerHookOptions`.
 */
export interface GlobalHookOptions {
	/**
	 * Whether to execute scripts sequentially instead of in parallel.
	 * Per-hook `sequential` overrides this default.
	 * @default false
	 */
	sequential?: boolean;
	/**
	 * Re-run pre-commit scripts on the unstaged-inclusive working tree state to avoid
	 * stash-apply conflicts after formatters modify staged files.
	 *
	 * When enabled, after the first run formats the staged content, the working tree is
	 * reset to the original (staged + unstaged) state and the same scripts run again.
	 * The index keeps the first-run result; the working tree gets the second-run result.
	 * This sidesteps the 3-way merge done by `git stash apply`, at the cost of running
	 * scripts twice when both unstaged changes and formatter modifications exist.
	 *
	 * Only takes effect for `pre-commit`.
	 *
	 * @default false
	 */
	replayFormatter?: boolean;
}

/**
 * Options that may be set per-hook via `HookConfigWithOpts`.
 *
 * Strictly a subset of `GlobalHookOptions`: only options the runtime actually
 * reads from the per-hook wrapper belong here.
 */
export interface PerHookOptions {
	/**
	 * Whether to execute scripts for this hook sequentially instead of in parallel.
	 * Overrides the top-level `sequential` for this hook.
	 * @default false
	 */
	sequential?: boolean;
}

/**
 * A wrapper for hook configuration that includes per-hook execution options.
 */
export interface HookConfigWithOpts<_T extends string, C>
	extends PerHookOptions {
	config: C;
}

/**
 * Defines the configuration structure for `ts-git-hooks`.
 * It ensures that hooks are configured correctly based on their type.
 *
 * - `pre-commit` uses a glob-based configuration.
 * - All other hooks use a simple script or script array.
 *
 * Pass your `package.json` script names as a generic for full type-safety.
 * @example
 * type Scripts = keyof typeof import('./package.json')['scripts'];
 * const config: TSGitHookConfig<Scripts> = {
 *   'pre-commit': { '*.ts': 'test' },
 *   'pre-push': 'build'
 * };
 */
export type TSGitHookConfig<T extends string = string> = GlobalHookOptions &
	Partial<{
		[K in GitHook]: K extends "preCommit" | "pre-commit"
			? GlobHookConfig<T> | HookConfigWithOpts<T, GlobHookConfig<T>>
			: SimpleHookConfig<T> | HookConfigWithOpts<T, SimpleHookConfig<T>>;
	}>;

/**
 * Represents the configuration for a single git hook, which can be either
 * glob-based or a simple script configuration.
 */
export type HookConfig<T extends string = string> =
	| GlobHookConfig<T>
	| SimpleHookConfig<T>;
