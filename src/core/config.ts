import path from "node:path";
import jiti from "jiti";
import type {
	CamelCaseGitHook,
	GlobHookConfig,
	HookConfig,
	TSGitHookConfig,
} from "../types";
import { kebabToCamel } from "../utils/string";

type Jiti = ReturnType<typeof jiti>;

const configFileName = "git-hooks.config.ts";

// Memoize jiti instance to avoid repeated initialization overhead
let _jiti: Jiti | undefined;

/**
 * Type guard to check if a hook configuration is glob-based.
 * @param hookConfig The configuration to check.
 */
export function isGlobHookConfig<T extends string>(
	hookConfig: HookConfig<T>,
): hookConfig is GlobHookConfig<T> {
	return (
		typeof hookConfig === "object" &&
		!Array.isArray(hookConfig) &&
		hookConfig !== null
	);
}

/**
 * Loads the ts-git-hooks configuration from the project root.
 * It uses `jiti` to require the TypeScript configuration file on the fly.
 * @returns The loaded configuration object, or null if the file doesn't exist.
 */
export async function loadConfig(): Promise<TSGitHookConfig | null> {
	const configFilePath = path.join(process.cwd(), configFileName);

	try {
		// Use jiti to dynamically require the .ts config file
		if (!_jiti) {
			_jiti = jiti(__filename);
		}
		const configModule = _jiti(configFilePath);

		if (configModule?.config) {
			const config = configModule.config as TSGitHookConfig;

			// Normalize all hook names to camelCase for internal consistency.
			const normalizedConfig: TSGitHookConfig = {};
			const configKeys = Object.keys(config) as (keyof TSGitHookConfig)[];

			for (const hookName of configKeys) {
				const hookValue = config[hookName as keyof typeof config];
				if (hookValue) {
					const camelCaseHookName = kebabToCamel(hookName) as CamelCaseGitHook;
					// biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment across mapped types requires any
					normalizedConfig[camelCaseHookName] = hookValue as any;
				}
			}
			return normalizedConfig;
		}

		return null;
	} catch (error: unknown) {
		// Jiti throws an error if the file doesn't exist, which is expected.
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code: string }).code === "MODULE_NOT_FOUND"
		) {
			return null;
		}
		// For other errors, log them as they might be syntax errors in the config.
		console.error(`Error loading ${configFileName}:`, error);
		return null;
	}
}
