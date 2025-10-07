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

export type Script = string | string[];

export interface HookConfig {
  run: Script;
}

export type TSGitHookConfig = Partial<Record<GitHook, HookConfig>>;