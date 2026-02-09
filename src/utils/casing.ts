import type { GitHook, KebabCaseGitHook } from "../types";
import { camelToKebab } from "./string";

/**
 * Converts a GitHook name (either camelCase or kebab-case) to its kebab-case version.
 * @param hook The hook name to convert.
 * @returns The kebab-case version of the hook name.
 */
export function toKebabCase(hook: GitHook): KebabCaseGitHook {
	return camelToKebab(hook) as KebabCaseGitHook;
}
