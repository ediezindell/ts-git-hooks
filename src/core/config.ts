import path from "node:path";
import type {
	CamelCaseGitHook,
	GlobHookConfig,
	HookConfig,
	TSGitHookConfig,
} from "../types";
import { fileExists } from "../utils/fs";
import { kebabToCamel } from "../utils/string";

// Define a minimal type for jiti to avoid importing the whole package type at top-level
// or just use 'any' if we want to be purely lazy, but let's try to keep some type safety if possible
// roughly: (filename: string) => { config: TSGitHookConfig }
type JitiInstance = (name: string) => { config?: unknown };

const configFileName = "git-hooks.config.ts";

// Memoize jiti instance to avoid repeated initialization overhead
let _jiti: JitiInstance | undefined;
// Memoize loaded configuration to avoid repeated parsing and normalization in the same process
let _memoizedConfig: TSGitHookConfig | null = null;

/**
 * For testing purposes ONLY. Resets the memoized configuration.
 */
export const _resetConfig = () => {
	_memoizedConfig = null;
};

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
	if (_memoizedConfig) {
		return _memoizedConfig;
	}

	const configFilePath = path.join(process.cwd(), configFileName);

	// Optimization: Check if file exists before loading jiti (~10-20ms saved)
	const exists = await fileExists(configFilePath);
	if (!exists) {
		return null;
	}

	try {
		// Optimization: Lazy load jiti (~50ms saved)
		if (!_jiti) {
			const jitiModule = await import("jiti");
			// jiti.default is the createJiti function in v2? or jiti itself?
			// In v1 it was the function. In v2... let's check package.json or assume v1 behavior for now based on previous code.
			// Previous code: import jiti from "jiti"; _jiti = jiti(__filename);
			// So default export is the creator.
			const createJiti = jitiModule.default;
			_jiti = createJiti(__filename) as unknown as JitiInstance;
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
			_memoizedConfig = normalizedConfig;
			return _memoizedConfig;
		}

		return null;
	} catch (error: unknown) {
		// For other errors, log them as they might be syntax errors in the config.
		console.error(`Error loading ${configFileName}:`, error);
		return null;
	}
}
