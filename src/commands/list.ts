import { loadConfig } from "../core/config";
import type {
	CamelCaseGitHook,
	Command,
	HookConfig,
	KebabCaseGitHook,
} from "../types";
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
		console.log("Configuration file not found.");
		return;
	}

	const configuredHooks = Object.keys(config) as CamelCaseGitHook[];

	if (configuredHooks.length === 0) {
		console.log("No hooks configured.");
		return;
	}

	console.log("Configured git hooks:");
	for (const hookName of configuredHooks) {
		const hookConfig = config[hookName];
		if (!hookConfig) {
			continue;
		}

		const kebabCaseHookName = camelToKebab(hookName) as KebabCaseGitHook;

		// Check if the hook config is for glob-based scripts (an object) or unconditional.
		if (
			typeof hookConfig === "object" &&
			!Array.isArray(hookConfig) &&
			hookConfig !== null
		) {
			console.log(`  - ${kebabCaseHookName}:`);
			for (const [glob, script] of Object.entries(hookConfig)) {
				console.log(`    - ${glob}: ${scriptsToString(script)}`);
			}
		} else {
			// Unconditional hook
			const scripts = scriptsToString(hookConfig);
			console.log(`  - ${kebabCaseHookName}: ${scripts}`);
		}
	}
}
