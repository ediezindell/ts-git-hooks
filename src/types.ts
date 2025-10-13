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
export type TSGitHookConfig<T extends string = string> = Partial<{
	[K in CamelCaseGitHook]: K extends "preCommit"
		? GlobHookConfig<T>
		: SimpleHookConfig<T>;
}>;

/**
 * Represents the configuration for a single git hook, which can be either
 * glob-based or a simple script configuration.
 */
export type HookConfig<T extends string = string> =
	| GlobHookConfig<T>
	| SimpleHookConfig<T>;
