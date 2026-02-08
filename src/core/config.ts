import path from "node:path";
import * as v from "valibot";
import type {
	CamelCaseGitHook,
	GlobHookConfig,
	HookConfig,
	TSGitHookConfig,
} from "../types";
import { fileExists } from "../utils/fs";
import { kebabToCamel } from "../utils/string";

const configFileName = "git-hooks.config.ts";

/**
 * Valibot schema for Git hook configuration validation.
 */
const CommandSchema = v.union([
	v.string(),
	v.tuple([v.string(), v.function()]),
]);

const ScriptSchema = v.union([CommandSchema, v.array(CommandSchema)]);

const GlobHookConfigSchema = v.record(v.string(), ScriptSchema);

const ConfigSchema = v.record(
	v.string(),
	v.union([ScriptSchema, GlobHookConfigSchema]),
);

// Define a minimal type for jiti to avoid importing the whole package type at top-level
type JitiInstance = (name: string) => { config?: unknown };

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
 * Initializes and returns the jiti instance for dynamic TypeScript loading.
 */
async function getJiti(): Promise<JitiInstance> {
	if (!_jiti) {
		const jitiModule = await import("jiti");
		const createJiti = jitiModule.default;
		_jiti = createJiti(__filename) as unknown as JitiInstance;
	}
	return _jiti;
}

/**
 * Normalizes configuration by converting all hook names to camelCase.
 * @param config The raw configuration object.
 */
function normalizeConfig(config: TSGitHookConfig): TSGitHookConfig {
	const normalized: TSGitHookConfig = {};

	for (const [hookName, hookValue] of Object.entries(config)) {
		if (hookValue) {
			const camelCaseHookName = kebabToCamel(hookName) as CamelCaseGitHook;
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment across mapped types requires any
			normalized[camelCaseHookName] = hookValue as any;
		}
	}

	return normalized;
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
	if (!(await fileExists(configFilePath))) {
		return null;
	}

	try {
		const jiti = await getJiti();
		const configModule = jiti(configFilePath);

		if (!configModule?.config) {
			return null;
		}

		// Validate configuration structure at runtime
		const result = v.safeParse(ConfigSchema, configModule.config);
		if (!result.success) {
			console.warn(
				`Invalid configuration in ${configFileName}:`,
				v.flatten(result.issues).nested,
			);
		}

		_memoizedConfig = normalizeConfig(configModule.config as TSGitHookConfig);
		return _memoizedConfig;
	} catch (error: unknown) {
		// For other errors, log them as they might be syntax errors in the config.
		console.error(`Error loading ${configFileName}:`, error);
		return null;
	}
}
