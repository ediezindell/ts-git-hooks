import path from "node:path";
import { pathToFileURL } from "node:url";
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

const HookValueSchema = v.union([
	ScriptSchema,
	GlobHookConfigSchema,
	v.object({
		sequential: v.optional(v.boolean()),
		config: v.union([ScriptSchema, GlobHookConfigSchema]),
	}),
]);

const ConfigSchema = v.intersect([
	v.object({
		sequential: v.optional(v.boolean()),
	}),
	v.record(v.string(), v.union([v.boolean(), HookValueSchema])),
]);

// Memoize loaded configuration to avoid repeated parsing and normalization in the same process
let _memoizedConfig: TSGitHookConfig | null = null;
let _configFileName = "git-hooks.config.ts";

/**
 * For testing purposes ONLY. Sets the configuration file name to load.
 */
export const _setConfigFileName = (name: string) => {
	_configFileName = name;
};

/**
 * For testing purposes ONLY. Resets the memoized configuration.
 */
export const _resetConfig = () => {
	_memoizedConfig = null;
	_configFileName = "git-hooks.config.ts";
};

/**
 * Type guard to check if a hook configuration is wrapped with options.
 */
export function isHookConfigWithOpts<_T extends string, C>(
	value: unknown,
): value is { sequential?: boolean; config: C } {
	return (
		typeof value === "object" &&
		value !== null &&
		"config" in value &&
		!Array.isArray(value)
	);
}

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
		hookConfig !== null &&
		!("config" in hookConfig)
	);
}

/**
 * Normalizes configuration by converting all hook names to camelCase.
 * @param config The raw configuration object.
 */
function normalizeConfig(config: TSGitHookConfig): TSGitHookConfig {
	const normalized: TSGitHookConfig = {};

	if (config.sequential !== undefined) {
		normalized.sequential = config.sequential;
	}

	for (const [key, value] of Object.entries(config)) {
		if (key === "sequential") continue;

		if (value) {
			const camelCaseHookName = kebabToCamel(key) as CamelCaseGitHook;

			// biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment across mapped types requires any
			normalized[camelCaseHookName] = value as any;
		}
	}

	return normalized;
}

/**
 * Loads the ts-git-hooks configuration from the project root.
 * It uses native dynamic import which supports TypeScript in modern Node.js.
 * @returns The loaded configuration object, or null if the file doesn't exist.
 */
export async function loadConfig(): Promise<TSGitHookConfig | null> {
	if (_memoizedConfig) {
		return _memoizedConfig;
	}

	const configFilePath = path.join(process.cwd(), _configFileName);

	// Optimization: Check if file exists before attempting to import
	if (!(await fileExists(configFilePath))) {
		return null;
	}

	try {
		// Native import() works with TypeScript in Node.js 22.6+ with --experimental-strip-types
		// or automatically in even newer versions.
		const fileUrl = pathToFileURL(configFilePath).href;
		const configModule = await import(`${fileUrl}?t=${Date.now()}`);

		if (!configModule?.config) {
			return null;
		}

		// Validate configuration structure at runtime
		const result = v.safeParse(ConfigSchema, configModule.config);
		if (!result.success) {
			console.warn(
				`Invalid configuration in ${_configFileName}:`,
				v.flatten(result.issues).nested,
			);
		}

		_memoizedConfig = normalizeConfig(configModule.config as TSGitHookConfig);
		return _memoizedConfig;
	} catch (error: unknown) {
		// For other errors, log them as they might be syntax errors in the config.
		console.error(`Error loading ${_configFileName}:`, error);
		return null;
	}
}
