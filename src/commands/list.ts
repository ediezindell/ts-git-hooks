import { isGlobHookConfig, loadConfig } from "../core/config";
import type { CamelCaseGitHook, Command, Script } from "../types";
import { toKebabCase } from "../utils/casing";
import { logger } from "../utils/logger";

/**
 * Converts a script configuration to a human-readable string.
 * @param script The script configuration to format.
 * @returns A comma-separated string of commands.
 */
function formatScriptConfig<T extends string>(script: Script<T>): string {
	const formatCommand = (command: Command<T>): string => {
		// If it's a tuple [script, argsFn], only show the script name.
		if (Array.isArray(command)) {
			return command[0];
		}
		return command;
	};

	// Normalize to an array of commands
	let commands: Command<T>[];

	if (Array.isArray(script)) {
		// Check if it's a single Command tuple [string, ArgsFn]
		// or an array of Commands.
		if (script.length === 2 && typeof script[1] === "function") {
			commands = [script as Command<T>];
		} else {
			commands = script as Command<T>[];
		}
	} else {
		commands = [script as Command<T>];
	}

	return commands.map(formatCommand).join(", ");
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

	const configuredHooks = Object.keys(config) as CamelCaseGitHook[];

	if (configuredHooks.length === 0) {
		logger.info("No hooks configured.");
		return;
	}

	logger.info("Configured git hooks:");
	for (const hookName of configuredHooks) {
		const hookConfig = config[hookName];
		if (!hookConfig) {
			continue;
		}

		const kebabCaseHookName = toKebabCase(hookName);

		// Check if the hook config is for glob-based scripts (an object) or unconditional.
		if (isGlobHookConfig(hookConfig)) {
			logger.log(`  - ${kebabCaseHookName}:`);
			for (const [glob, script] of Object.entries(hookConfig)) {
				logger.log(`    - ${glob}: ${formatScriptConfig(script)}`);
			}
		} else {
			// Unconditional hook
			const scripts = formatScriptConfig(hookConfig);
			logger.log(`  - ${kebabCaseHookName}: ${scripts}`);
		}
	}
}
