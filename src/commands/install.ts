import { promises as fs } from "node:fs";
import path from "node:path";
import { quote } from "shell-quote";
import { loadConfig } from "../core/config";
import type { CamelCaseGitHook, KebabCaseGitHook } from "../types";
import { toKebabCase } from "../utils/casing";
import { logger } from "../utils/logger";
import {
	getPackageManager,
	type PackageManager,
} from "../utils/packageManager";

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
 * Resolves the absolute path to dist/cli.js from the running CLI process so the
 * hook script can invoke node directly with --experimental-strip-types and skip
 * the self-respawn fork. Returns null when the entry path is not recognizable
 * (e.g. test runners, Yarn PnP virtual paths) so callers fall back to legacy
 * invocation.
 */
export function getDistCliPath(): string | null {
	const entry = process.argv[1];
	if (!entry || !entry.endsWith("cli.js")) return null;
	return entry;
}

/**
 * Generates the shell command for a git hook, including an optimization for local execution.
 * @param packageManager The detected package manager.
 * @param hookName The kebab-case name of the git hook.
 * @param cliPath Absolute path to dist/cli.js, or null when unavailable.
 */
function getHookExecutionCommand(
	packageManager: PackageManager,
	hookName: string,
	cliPath: string | null,
): string {
	const fallbackCommand =
		packageManager === "npm"
			? `exec npm exec ts-git-hooks run ${hookName}`
			: `exec ${packageManager} ts-git-hooks run ${hookName}`;

	const legacyBranch = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run ${hookName}
else
  ${fallbackCommand}
fi`;

	if (!cliPath) return legacyBranch;

	const quotedCliPath = quote([cliPath]);
	// First branch invokes node with --experimental-strip-types directly, avoiding
	// the cli.js self-respawn (~30-100ms per hook). Falls back to .bin shim, then
	// the package manager, if the embedded path no longer points to a real file.
	return `if [ -f ${quotedCliPath} ]; then
  exec node --experimental-strip-types ${quotedCliPath} run ${hookName}
elif [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run ${hookName}
else
  ${fallbackCommand}
fi`;
}

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

				// Security check: only allow valid hook names (alphanumeric and hyphens)
				// This prevents path traversal and command injection in the generated script.
				if (!/^[a-z0-9-]+$/.test(kebabCaseHookName)) {
					logger.warn(`Skipping invalid hook name: ${kebabCaseHookName}`);
					return;
				}

				const hookPath = path.join(gitHooksDir, kebabCaseHookName);

				const command = getHookExecutionCommand(
					packageManager,
					kebabCaseHookName,
					getDistCliPath(),
				);
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
