import path from "node:path";
import jiti from "jiti";
import type { GitHook, TSGitHookConfig } from "../types";
import { toKebabCase } from "../utils/casing";

const configFileName = "ts-git-hooks.config.ts";

/**
 * Loads the ts-git-hooks configuration from the project root.
 * It uses `jiti` to require the TypeScript configuration file on the fly.
 * @returns The loaded configuration object, or null if the file doesn't exist.
 */
export async function loadConfig(): Promise<TSGitHookConfig | null> {
	const configFilePath = path.join(process.cwd(), configFileName);

	try {
		// Use jiti to dynamically require the .ts config file
		const _jiti = jiti(__filename);
		const configModule = _jiti(configFilePath);

		if (configModule?.config) {
			const config = configModule.config as TSGitHookConfig;

			// Normalize keys to kebab-case
			const normalizedConfig: TSGitHookConfig = {};
			const configKeys = Object.keys(config) as GitHook[];

			for (const hookName of configKeys) {
				const kebabCaseHookName = toKebabCase(hookName);
				const hookValue = config[hookName];
				if (hookValue) {
					normalizedConfig[kebabCaseHookName] = hookValue as any;
				}
			}
			return normalizedConfig;
		}

		return null;
	} catch (error: unknown) {
		// Jiti throws an error if the file doesn't exist, which is expected.
		if ((error as any)?.code === "MODULE_NOT_FOUND") {
			return null;
		}
		// For other errors, log them as they might be syntax errors in the config.
		console.error(`Error loading ${configFileName}:`, error);
		return null;
	}
}
