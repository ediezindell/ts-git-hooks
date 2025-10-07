type GitHookName =
  | 'applypatch-msg'
  | 'pre-applypatch'
  | 'post-applypatch'
  | 'pre-commit'
  | 'pre-merge-commit'
  | 'prepare-commit-msg'
  | 'commit-msg'
  | 'post-commit'
  | 'pre-rebase'
  | 'post-checkout'
  | 'post-merge'
  | 'pre-push'
  | 'pre-receive'
  | 'update'
  | 'post-receive'
  | 'post-update'
  | 'push-to-checkout'
  | 'pre-auto-gc'
  | 'post-rewrite'
  | 'sendemail-validate'
  // camelCase aliases
  | 'applypatchMsg'
  | 'preApplypatch'
  | 'postApplypatch'
  | 'preCommit'
  | 'preMergeCommit'
  | 'prepareCommitMsg'
  | 'commitMsg'
  | 'postCommit'
  | 'preRebase'
  | 'postCheckout'
  | 'postMerge'
  | 'prePush'
  | 'preReceive'
  | 'postReceive'
  | 'postUpdate'
  | 'pushToCheckout'
  | 'preAutoGc'
  | 'postRewrite'
  | 'sendemailValidate';

/**
 * Defines the structure for the ts-git-hooks configuration object.
 * Users will define their hooks in a `ts-git-hooks.config.ts` file according to this type.
 */
export type TSGitHookConfig = {
  [key in GitHookName]?: {
    /** The npm script(s) to run for the given hook. Can be a single script or an array of scripts to be run in parallel. */
    run: string | string[];
  };
};