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
 * The configuration for a single git hook.
 * This is a mapping of glob patterns to a single script command.
 * A special `*` key can be used to execute a script unconditionally.
 *
 * The type parameter `T` is expected to be a union of available script names.
 *
 * @example
 * // Glob-based configuration
 * {
 *   '*.ts': 'tsc',
 *   '*.{js,ts}': 'eslint --fix'
 * }
 *
 * @example
 * // Unconditional script
 * {
 *   '*': 'test'
 * }
 */
export type HookConfig<T extends string> = Record<string, T>;

/**
 * The main configuration type for `ts-git-hooks`.
 * This type is generic. To get full type-safety, users should provide
 * their package.json script names as the type parameter.
 *
 * @example
 * import type { TSGitHookConfig } from 'ts-git-hooks';
 * import pkg from './package.json'; // Make sure resolveJsonModule is true in tsconfig
 *
 * type Scripts = keyof typeof pkg.scripts;
 *
 * export const config: TSGitHookConfig<Scripts> = {
 *   'pre-commit': {
 *     '*.ts': 'test'
 *   },
 *   'pre-push': {
 *      '*': 'build'
 *   }
 * };
 */
export type TSGitHookConfig<T extends string = string> = Partial<
	Record<GitHook, HookConfig<T>>
>;
