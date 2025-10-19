import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config";
import type { CamelCaseGitHook, KebabCaseGitHook } from "../types";
import { getPackageManager } from "../utils/packageManager";
import { camelToKebab } from "../utils/string";

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");

/**
 * Generates the shell script content for a git hook.
 * This script will call the ts-git-hooks runner for the specific hook.
 * @param hook The name of the git hook.
 */
const hookScriptContent = (
	hook: KebabCaseGitHook,
	command: string,
) => `#!/bin/sh
# This hook was installed by ts-git-hooks
# To uninstall, run 'npx ts-git-hooks uninstall'

${command} ${hook}
`;

/**
 * Installs the git hooks based on the configuration file.
 */
export async function install() {
	const config = await loadConfig();
	if (!config || Object.keys(config).length === 0) {
		console.log(
			"Configuration file not found or is empty. No hooks to install.",
		);
		return;
	}

	try {
		const packageManager = getPackageManager();
		let runCommand: string;
		switch (packageManager) {
			case "yarn":
			case "pnpm":
				runCommand = `${packageManager} ts-git-hooks run`;
				break;
			case "npm":
				runCommand = `npm exec ts-git-hooks run`;
				break;
		}

		// 1. Ensure the .git/hooks directory exists.
		await fs.mkdir(gitHooksDir, { recursive: true });

		const installedHooks: KebabCaseGitHook[] = [];
		const hookNames = Object.keys(config) as CamelCaseGitHook[];

		for (const hookName of hookNames) {
			if (!config[hookName]) continue;

			const kebabCaseHookName = camelToKebab(hookName) as KebabCaseGitHook;
			const hookPath = path.join(gitHooksDir, kebabCaseHookName);
			const scriptContent = hookScriptContent(kebabCaseHookName, runCommand);

			// 2. Write the hook script file.
			await fs.writeFile(hookPath, scriptContent, "utf-8");

			// 3. Make the hook script executable.
			await fs.chmod(hookPath, 0o755);

			installedHooks.push(kebabCaseHookName);
		}

		if (installedHooks.length > 0) {
			console.log("ts-git-hooks installed successfully.");
			for (const hookName of installedHooks) {
				console.log(`  - ${hookName}`);
			}
		} else {
			console.log("No hooks were configured to be installed.");
		}
	} catch (error) {
		console.error("Failed to install git hooks:", error);
	}
}
