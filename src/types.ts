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
 * Represents a single script or an array of scripts to be run.
 * The type parameter `T` is expected to be a union of available script names.
 */
export type Script<T extends string> = T | T[];

/**
 * The configuration for a single git hook.
 * The type parameter `T` is expected to be a union of available script names.
 */
export interface HookConfig<T extends string> {
  run: Script<T>;
}

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
 *   'pre-commit': { run: 'lint' } // Will be type-checked
 * };
 */
export type TSGitHookConfig<T extends string = string> = Partial<
  Record<GitHook, HookConfig<T>>
>;