import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config";
import type { CamelCaseGitHook, KebabCaseGitHook } from "../types";
import { toKebabCase } from "../utils/casing";
import { logger } from "../utils/logger";
import { getPackageManager } from "../utils/packageManager";

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");

/**
 * Generates the shell script content for a git hook.
 * This script will call the ts-git-hooks runner for the specific hook.
 * @param command The full command to execute.
 */
const hookScriptContent = (command: string) => `#!/bin/sh
# This hook was installed by ts-git-hooks
# To uninstall, run 'npx ts-git-hooks uninstall'

${command}
`;

/**
 * Installs the git hooks based on the configuration file.
 */
export async function install() {
	const config = await loadConfig();
	if (!config || Object.keys(config).length === 0) {
		logger.warn(
			"Configuration file not found or is empty. No hooks to install.",
		);
		return;
	}

	try {
		const packageManager = getPackageManager();

		// 1. Ensure the .git/hooks directory exists.
		await fs.mkdir(gitHooksDir, { recursive: true });

		const installedHooks: KebabCaseGitHook[] = [];
		const hookNames = Object.keys(config) as CamelCaseGitHook[];

		await Promise.all(
			hookNames.map(async (hookName) => {
				if (!config[hookName]) return;

				const kebabCaseHookName = toKebabCase(hookName);
				const hookPath = path.join(gitHooksDir, kebabCaseHookName);

				let fallbackCommand = "";
				switch (packageManager) {
					case "npm":
						fallbackCommand = `exec npm exec ts-git-hooks run ${kebabCaseHookName}`;
						break;
					case "yarn":
					case "pnpm":
						fallbackCommand = `exec ${packageManager} ts-git-hooks run ${kebabCaseHookName}`;
						break;
				}

				// Optimization: Check for local binary to bypass package manager overhead (~300ms for npm exec).
				// This optimization is now applied to all package managers as direct execution is always faster.
				const command = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run ${kebabCaseHookName}
else
  ${fallbackCommand}
fi`;

				const scriptContent = hookScriptContent(command);

				// 2. Write the hook script file.
				await fs.writeFile(hookPath, scriptContent, "utf-8");

				// 3. Make the hook script executable.
				await fs.chmod(hookPath, 0o755);

				installedHooks.push(kebabCaseHookName);
			}),
		);

		if (installedHooks.length > 0) {
			logger.success("ts-git-hooks installed successfully.");
			for (const hookName of installedHooks) {
				logger.log(`  - ${hookName}`);
			}
		} else {
			logger.info("No hooks were configured to be installed.");
		}
	} catch (error) {
		logger.error("Failed to install git hooks:");
		logger.error(error);
	}
}
