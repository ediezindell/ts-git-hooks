import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config";
import type { CamelCaseGitHook, KebabCaseGitHook } from "../types";
import { toKebabCase } from "../utils/casing";
import { fileExists } from "../utils/fs";
import { logger } from "../utils/logger";

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");
const hookIdentifier = "# This hook was installed by ts-git-hooks";

/**
 * Uninstalls git hooks managed by ts-git-hooks.
 */
export async function uninstall() {
	const config = await loadConfig();
	const configuredHooks = config
		? (Object.keys(config) as CamelCaseGitHook[])
		: [];

	if (configuredHooks.length === 0) {
		logger.info("No hooks configured. Nothing to uninstall.");
		return;
	}

	const results = await Promise.all(
		configuredHooks.map(async (hookName) => {
			const kebabCaseHookName = toKebabCase(hookName);
			const hookPath = path.join(gitHooksDir, kebabCaseHookName);

			if (!(await fileExists(hookPath))) {
				return null;
			}

			try {
				const content = await fs.readFile(hookPath, "utf-8");
				if (content.includes(hookIdentifier)) {
					await fs.unlink(hookPath);
					return kebabCaseHookName;
				}
			} catch (_error) {
				// Ignore errors for reading/unlinking, as the file might be gone
			}
			return null;
		}),
	);

	const removedHooks = results.filter((h): h is KebabCaseGitHook => h !== null);

	if (removedHooks.length > 0) {
		logger.success("ts-git-hooks uninstalled successfully.");
		for (const hookName of removedHooks) {
			logger.log(`  - Removed ${hookName}`);
		}
	} else {
		logger.info("No ts-git-hooks to uninstall.");
	}
}
