import {
	isGlobHookConfig,
	isHookConfigWithOpts,
	loadConfig,
} from "../core/config";
import type {
	CamelCaseGitHook,
	Command,
	HookConfig,
	KebabCaseGitHook,
} from "../types";
import { logger } from "../utils/logger";
import { camelToKebab } from "../utils/string";

function scriptsToString<T extends string>(script: HookConfig<T>): string {
	const formatCommand = (command: Command<T>): string => {
		if (Array.isArray(command)) {
			return String(command[0]);
		}
		return String(command);
	};

	if (Array.isArray(script)) {
		// It could be Command<T>[] or a single Command<T> that is a tuple [string, ArgsFn]
		if (script.length === 2 && typeof script[1] === "function") {
			return (script as [T, (files: string[]) => string])[0];
		}
		return (script as Command<T>[]).map(formatCommand).join(", ");
	}
	return formatCommand(script as Command<T>);
}

/**
 * Lists all the configured git hooks and their scripts.
 */
export async function list() {
	const config = await loadConfig();

	if (!config) {
		logger.error("Configuration file not found.");
		return;
	}

	const configuredHooks = Object.keys(config) as (keyof typeof config)[];

	if (configuredHooks.length === 0) {
		logger.info("No hooks configured.");
		return;
	}

	logger.info("Configured git hooks:");
	for (const hookName of configuredHooks) {
		if (hookName === "sequential") continue;

		const rawHookConfig = config[hookName as CamelCaseGitHook];
		if (!rawHookConfig) {
			continue;
		}

		let hookConfig: HookConfig;
		let extraInfo = "";

		if (isHookConfigWithOpts(rawHookConfig)) {
			hookConfig = rawHookConfig.config;
			if (rawHookConfig.sequential !== undefined) {
				extraInfo = ` (${rawHookConfig.sequential ? "sequential" : "parallel"})`;
			}
		} else {
			hookConfig = rawHookConfig as HookConfig;
		}

		const kebabCaseHookName = camelToKebab(hookName) as KebabCaseGitHook;

		// Check if the hook config is for glob-based scripts (an object) or unconditional.
		if (isGlobHookConfig(hookConfig)) {
			logger.log(`  - ${kebabCaseHookName}${extraInfo}:`);
			for (const [glob, script] of Object.entries(hookConfig)) {
				logger.log(`    - ${glob}: ${scriptsToString(script)}`);
			}
		} else {
			// Unconditional hook
			const scripts = scriptsToString(hookConfig);
			logger.log(`  - ${kebabCaseHookName}${extraInfo}: ${scripts}`);
		}
	}
}
