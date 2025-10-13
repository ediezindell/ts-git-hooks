import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config";
import type { GitHook, Script, TSGitHookConfig } from "../types";

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");

/**
 * Generates the shell script content for a git hook.
 * This script will call the ts-git-hooks runner for the specific hook.
 * @param hook The name of the git hook.
 */
const hookScriptContent = (hook: GitHook) => `#!/bin/sh
# This hook was installed by ts-git-hooks
# To uninstall, run 'npx ts-git-hooks uninstall'

npx ts-git-hooks run ${hook}
`;

/**
 * A helper function to recursively get all script names from the config.
 * @param config The hook configuration.
 * @returns An array of script names.
 */
function getScriptNames<T extends string>(config: Script<T>): T[] {
	if (Array.isArray(config)) {
		return config.flatMap((c) => getScriptNames(c as Script<T>));
	}
	if (typeof config === "string") {
		return [config];
	}
	if (Array.isArray(config) && typeof config[0] === "string") {
		return [config[0] as T];
	}
	return [];
}

/**
 * Validates the configuration against the package.json scripts.
 * @param config The ts-git-hooks configuration.
 * @param pkg The package.json content.
 */
function validateConfig<T extends string>(
	config: TSGitHookConfig<T>,
	pkg: { scripts?: Record<T, string> },
) {
	if (!pkg.scripts) {
		throw new Error("No scripts found in package.json.");
	}

	const availableScripts = Object.keys(pkg.scripts) as T[];
	const allScripts = Object.values(config).flatMap((hookConfig) => {
		if (!hookConfig) return [];
		return Object.values(hookConfig).flatMap((script) =>
			getScriptNames(script as Script<T>),
		);
	});

	const uniqueScripts = [...new Set(allScripts)];
	const invalidScripts = uniqueScripts.filter(
		(script) => !availableScripts.includes(script),
	);

	if (invalidScripts.length > 0) {
		throw new Error(
			`Invalid scripts found in config: ${invalidScripts.join(", ")}`,
		);
	}
}

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

	const pkgPath = path.join(process.cwd(), "package.json");
	const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

	try {
		validateConfig(config, pkg);

		// 1. Ensure the .git/hooks directory exists.
		await fs.mkdir(gitHooksDir, { recursive: true });

		const installedHooks: GitHook[] = [];
		const hookNames = Object.keys(config) as GitHook[];

		for (const hookName of hookNames) {
			if (!config[hookName]) continue;

			const hookPath = path.join(gitHooksDir, hookName);
			const scriptContent = hookScriptContent(hookName);

			// 2. Write the hook script file.
			await fs.writeFile(hookPath, scriptContent, "utf-8");

			// 3. Make the hook script executable.
			await fs.chmod(hookPath, 0o755);

			installedHooks.push(hookName);
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
