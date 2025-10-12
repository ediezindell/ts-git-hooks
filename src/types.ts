export type GitHook =
  // Client-Side Hooks
  | 'pre-commit'
  | 'prepare-commit-msg'
  | 'commit-msg'
  | 'post-commit'
  | 'pre-rebase'
  | 'post-rewrite'
  | 'post-checkout'
  | 'post-merge'
  | 'pre-push'
  | 'pre-auto-gc'
  // Server-Side Hooks
  | 'pre-receive'
  | 'update'
  | 'post-receive';

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
 * The configuration for a single git hook.
 * This can be a mapping of glob patterns to scripts.
 * For backward compatibility, a `run` key can be used to execute scripts
 * unconditionally.
 *
 * The type parameter `T` is expected to be a union of available script names.
 *
 * @example
 * // Glob-based configuration
 * {
 *   '*.ts': 'tsc',
 *   '*.{js,ts}': ['eslint --fix', 'prettier --write']
 * }
 *
 * @example
 * // Simple configuration (backward compatible)
 * {
 *   run: ['test', 'lint']
 * }
 */
export type HookConfig<T extends string> = Record<string, Script<T>>;

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
 *      run: 'build'
 *   }
 * };
 */
export type TSGitHookConfig<T extends string = string> = Partial<
  Record<GitHook, HookConfig<T>>
>;