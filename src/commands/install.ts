import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { quote } from "shell-quote";
import { loadConfig } from "../core/config";
import type { CamelCaseGitHook, KebabCaseGitHook } from "../types";
import { toKebabCase } from "../utils/casing";
import { getGitHooksDir } from "../utils/git";
import { logger } from "../utils/logger";
import {
	getPackageManager,
	type PackageManager,
} from "../utils/packageManager";

const REGISTRY_FILENAME = ".ts-git-hooks-installed.json";
const BACKUPS_DIRNAME = ".ts-git-hooks-backups";

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

async function readRegistry(gitHooksDir: string): Promise<string[]> {
	const registryPath = path.join(gitHooksDir, REGISTRY_FILENAME);
	try {
		const content = await fs.readFile(registryPath, "utf-8");
		const parsed = JSON.parse(content);
		return Array.isArray(parsed.hooks)
			? parsed.hooks.filter((h: unknown) => typeof h === "string")
			: [];
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
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
		const gitHooksDir = await getGitHooksDir();

		// 1. Ensure the .git/hooks directory exists.
		await fs.mkdir(gitHooksDir, { recursive: true });

		const existingRegistry = await readRegistry(gitHooksDir);
		const backupDir = path.join(
			gitHooksDir,
			BACKUPS_DIRNAME,
			new Date().toISOString().replace(/[:.]/g, "-"),
		);

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

				// Back up a pre-existing non-managed hook so the install does not
				// silently destroy a user-authored or third-party hook.
				if (!existingRegistry.includes(kebabCaseHookName)) {
					try {
						await fs.lstat(hookPath);
						await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
						const backupPath = path.join(backupDir, kebabCaseHookName);
						await fs.rename(hookPath, backupPath);
						logger.warn(
							`Backed up existing ${kebabCaseHookName} to ${backupPath}`,
						);
					} catch (err) {
						if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
					}
				}

				const command = getHookExecutionCommand(
					packageManager,
					kebabCaseHookName,
					getDistCliPath(),
				);
				const scriptContent = hookScriptContent(command);

				// Atomic, symlink-safe write: stage the script in a sibling tmp file
				// so that rename() replaces the directory entry without following any
				// pre-existing symlink at hookPath, and the mode is set before the
				// final placement (no TOCTOU between write and chmod).
				const tmpPath = `${hookPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
				try {
					await fs.writeFile(tmpPath, scriptContent, "utf-8");
					await fs.chmod(tmpPath, 0o755);
					await fs.rename(tmpPath, hookPath);
				} catch (err) {
					await fs.unlink(tmpPath).catch(() => {});
					throw err;
				}

				installedHooks.push(kebabCaseHookName);
			}),
		);

		if (installedHooks.length > 0) {
			const registryPath = path.join(gitHooksDir, REGISTRY_FILENAME);
			const registryTmp = `${registryPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
			const merged = Array.from(
				new Set([...existingRegistry, ...installedHooks]),
			);
			try {
				await fs.writeFile(
					registryTmp,
					JSON.stringify({ hooks: merged }),
					"utf-8",
				);
				await fs.rename(registryTmp, registryPath);
			} catch (err) {
				await fs.unlink(registryTmp).catch(() => {});
				throw err;
			}
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
