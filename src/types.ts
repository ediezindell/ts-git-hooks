export type GitHook =
	// Client-Side Hooks
	| "pre-commit"
	| "prepare-commit-msg"
	| "commit-msg"
	| "post-commit"
	| "pre-rebase"
	| "post-rewrite"
	| "post-checkout"
	| "post-merge"
	| "pre-push"
	| "pre-auto-gc"
	// Server-Side Hooks
	| "pre-receive"
	| "update"
	| "post-receive";

/**
 * A function that takes a list of file paths and returns a command string.
 */
export type ArgsFn = (files: string[]) => string;

/**
 * Represents a command to be executed. It can be a simple string (script name)
 * or a tuple containing the script name and a function to generate arguments.
 * The type parameter `T` is expected to be a union of available script names.
 */
export type Command<T extends string> = T | [T, ArgsFn];

/**
 * Represents a single script or an array of scripts to be run.
 * The type parameter `T` is expected to be a union of available script names.
 */
export type Script<T extends string> = Command<T> | Command<T>[];

/**
 * A list of git hooks that are file-dependent and expect a glob pattern configuration.
 * Currently, only `pre-commit` is supported as a file-dependent hook.
 */
export type FileDependentHook = "pre-commit";

/**
 * A list of git hooks that are not file-dependent and expect a simple script configuration.
 */
export type FileIndependentHook = Exclude<GitHook, FileDependentHook>;

/**
 * Configuration for file-dependent hooks like `pre-commit`.
 * It's an object where keys are glob patterns and values are the scripts to run.
 * The type parameter `T` is expected to be a union of available script names.
 *
 * @example
 * {
 *   '*.ts': 'tsc',
 *   '*.{js,ts}': ['eslint --fix', 'prettier --write']
 * }
 */
export type GlobHookConfig<T extends string> = Record<string, Script<T>>;

/**
 * Configuration for file-independent hooks like `pre-push`.
 * It's a script string or an array of script strings to be executed unconditionally.
 * The type parameter `T` is expected to be a union of available script names.
 *
 * @example
 * 'test' // or ['test', 'build']
 */
export type SimpleHookConfig<T extends string> = Script<T>;

/**
 * The main configuration type for `ts-git-hooks`.
 * This type is generic and provides full type-safety by ensuring that:
 * - `pre-commit` hooks use a glob-based configuration.
 * - All other hooks use a simple script or script array.
 *
 * To get full type-safety with your project's scripts, provide the script
 * names from your `package.json` as the type parameter.
 *
 * @example
 * import type { TSGitHookConfig } from 'ts-git-hooks';
 * import pkg from './package.json'; // Make sure resolveJsonModule is true in tsconfig
 *
 * type Scripts = keyof typeof pkg.scripts;
 *
 * export const config: TSGitHookConfig<Scripts> = {
 *   // Glob-based for the file-dependent 'pre-commit' hook
 *   'pre-commit': {
 *     '*.ts': 'test'
 *   },
 *   // Direct script for the file-independent 'pre-push' hook
 *   'pre-push': 'build'
 * };
 */
export type TSGitHookConfig<T extends string = string> = Partial<{
	[K in GitHook]: K extends FileDependentHook
		? GlobHookConfig<T>
		: SimpleHookConfig<T>;
}>;
