import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config";
import type { KebabCaseGitHook } from "../types";
import { logger } from "../utils/logger";

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");
const hookIdentifier = "# This hook was installed by ts-git-hooks";

/**
 * Checks if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Uninstalls git hooks managed by ts-git-hooks.
 */
export async function uninstall() {
	const config = await loadConfig();
	const configuredHooks = config
		? (Object.keys(config) as KebabCaseGitHook[])
		: [];

	if (configuredHooks.length === 0) {
		logger.info("No hooks configured. Nothing to uninstall.");
		return;
	}

	const removedHooks: KebabCaseGitHook[] = [];

	for (const hookName of configuredHooks) {
		const hookPath = path.join(gitHooksDir, hookName);

		if (await fileExists(hookPath)) {
			try {
				const content = await fs.readFile(hookPath, "utf-8");
				if (content.includes(hookIdentifier)) {
					await fs.unlink(hookPath);
					removedHooks.push(hookName);
				}
			} catch (_error) {
				// Ignore errors for reading/unlinking, as the file might be gone
			}
		}
	}

	if (removedHooks.length > 0) {
		logger.success("ts-git-hooks uninstalled successfully.");
		for (const hookName of removedHooks) {
			logger.log(`  - Removed ${hookName}`);
		}
	} else {
		logger.info("No ts-git-hooks to uninstall.");
	}
}
