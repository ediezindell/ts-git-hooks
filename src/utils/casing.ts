import type { CamelCaseGitHook, GitHook, KebabCaseGitHook } from "../types";

export const kebabCaseGitHooks: KebabCaseGitHook[] = [
	"pre-commit",
	"prepare-commit-msg",
	"commit-msg",
	"post-commit",
	"pre-rebase",
	"post-rewrite",
	"post-checkout",
	"post-merge",
	"pre-push",
	"pre-auto-gc",
];

const camelToKebabMap = {
	preCommit: "pre-commit",
	prepareCommitMsg: "prepare-commit-msg",
	commitMsg: "commit-msg",
	postCommit: "post-commit",
	preRebase: "pre-rebase",
	postRewrite: "post-rewrite",
	postCheckout: "post-checkout",
	postMerge: "post-merge",
	prePush: "pre-push",
	preAutoGc: "pre-auto-gc",
} as const;

export function toKebabCase(hook: GitHook): KebabCaseGitHook {
	if (kebabCaseGitHooks.includes(hook as KebabCaseGitHook)) {
		return hook as KebabCaseGitHook;
	}
	return camelToKebabMap[hook as CamelCaseGitHook];
}