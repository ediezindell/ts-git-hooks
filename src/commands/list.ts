import { loadConfig } from "../core/config";
import type { Command, GitHook, Script } from "../types";

function scriptsToString<T extends string>(script: Script<T>): string {
	const formatCommand = (command: Command<T>): string => {
		if (Array.isArray(command)) {
			return command[0];
		}
		return command;
	};

	if (Array.isArray(script)) {
		// It could be Command<T>[] or a single Command<T> that is a tuple [T, ArgsFn]
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

	const configuredHooks = Object.keys(config) as GitHook[];

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

		if ("run" in hookConfig) {
			const scripts = scriptsToString(hookConfig.run);
			console.log(`  - ${hookName}: ${scripts}`);
		} else {
			console.log(`  - ${hookName}:`);
			for (const [glob, script] of Object.entries(hookConfig)) {
				console.log(`    - ${glob}: ${scriptsToString(script)}`);
			}
		}
	}
}
