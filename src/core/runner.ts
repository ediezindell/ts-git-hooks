import { type ChildProcess, spawn } from "node:child_process";
import type {
	ArgsFn,
	CamelCaseGitHook,
	Command,
	HookConfig,
	KebabCaseGitHook,
	Script,
} from "../types";
import {
	addFiles,
	getChangedFiles,
	getStagedFiles,
	stashPop,
	stashPushKeepIndex,
} from "../utils/git";
import { logger } from "../utils/logger";
import { kebabToCamel } from "../utils/string";
import { loadConfig } from "./config";

/**
 * Represents an executable command.
 * Can be a simple string (handled via shell) or an object with split arguments (handled directly).
 */
export type Executable = string | { script: string; args: string[] };

/**
 * Processes a command, resolving it to a final Executable.
 * @param command The command to process.
 * @param files The list of files to pass to the command.
 * @returns The resolved Executable.
 */
function processCommand(
	command: Command<string>,
	files: string[],
	isGlob: boolean,
): Executable {
	if (Array.isArray(command) && typeof command[1] === "function") {
		// Command is a tuple: [script, formatArguments]
		const [script, formatArguments] = command as [string, ArgsFn];
		return formatArguments(files, script);
	}

	const script = String(command);
	// For glob-based hooks, append file paths by default.
	// For other hooks, only do so if they explicitly use a function.
	if (isGlob && files.length > 0) {
		// Optimization: Return object to avoid shell spawn and improve argument safety
		return { script, args: files };
	}

	return script;
}

/**
 * Normalizes a script configuration into a consistent array of commands.
 * @param script The script configuration to process.
 * @returns An array of commands.
 */
const getCommands = (script: Script<string>): Command<string>[] => {
	if (Array.isArray(script)) {
		// Check if it's a command tuple like [string, ArgsFn]
		if (
			script.length === 2 &&
			typeof script[0] === "string" &&
			typeof script[1] === "function"
		) {
			return [script as Command<string>];
		}
		// Otherwise, it's an array of commands
		return script as Command<string>[];
	}
	// It's a single command string
	return [script as Command<string>];
};

/**
 * Determines if we need to fetch staged files based on the hook configuration.
 * @param hookConfig The configuration for the hook.
 * @returns True if staged files are needed, false otherwise.
 */
function shouldFetchStagedFiles(hookConfig: HookConfig): boolean {
	const isGlob =
		typeof hookConfig === "object" &&
		!Array.isArray(hookConfig) &&
		hookConfig !== null;

	if (isGlob) {
		return true;
	}

	// For simple hooks, check if any command uses a custom argument function.
	const commands = getCommands(hookConfig);
	return commands.some(
		(cmd) => Array.isArray(cmd) && typeof cmd[1] === "function",
	);
}

/**
 * Checks if two commands are equal.
 * Equality is defined as:
 * - Both are identical strings.
 * - Both are tuples with identical script name and function reference.
 */
function areCommandsEqual(a: Command<string>, b: Command<string>): boolean {
	if (typeof a === "string" && typeof b === "string") {
		return a === b;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return a[0] === b[0] && a[1] === b[1];
	}
	return false;
}

/**
 * Resolves the scripts to run for a given hook configuration.
 * @param hookConfig The configuration for the specific git hook.
 * @param stagedFiles The list of currently staged files.
 * @returns An array of script strings to execute.
 */
export async function resolveScriptsToRun(
	hookConfig: HookConfig,
	stagedFiles: string[] | null,
): Promise<{ scripts: Executable[]; matchedFiles: string[] | null }> {
	const scriptsToRun: Executable[] = [];
	const batchedCommands: {
		command: Command<string>;
		files: Set<string>;
	}[] = [];

	const processListOfCommands = (
		commands: Command<string>[],
		files: string[],
	) => {
		for (const command of commands) {
			let batch = batchedCommands.find((b) =>
				areCommandsEqual(b.command, command),
			);
			if (!batch) {
				batch = { command, files: new Set() };
				batchedCommands.push(batch);
			}
			for (const file of files) {
				batch.files.add(file);
			}
		}
	};

	const isGlob =
		typeof hookConfig === "object" &&
		!Array.isArray(hookConfig) &&
		hookConfig !== null;

	let matchedFiles: string[] | null = null;

	if (isGlob) {
		const matchedFilesSet = new Set<string>();

		if (stagedFiles && stagedFiles.length > 0) {
			// Optimization: Lazy load micromatch only when needed
			const { default: micromatch } = await import("micromatch");

			for (const [globPattern, script] of Object.entries(hookConfig)) {
				const matchingFiles = micromatch(stagedFiles, globPattern, {
					matchBase: true,
				});

				for (const file of matchingFiles) {
					matchedFilesSet.add(file);
				}

				if (matchingFiles.length > 0) {
					const commandsToProcess = getCommands(script);
					processListOfCommands(commandsToProcess, matchingFiles);
				}
			}
		}
		matchedFiles = Array.from(matchedFilesSet);
	}
	// Case 2: Unconditional configuration
	else {
		const commandsToProcess = getCommands(hookConfig);
		processListOfCommands(commandsToProcess, stagedFiles ?? []);
	}

	for (const batch of batchedCommands) {
		scriptsToRun.push(
			processCommand(batch.command, Array.from(batch.files), isGlob),
		);
	}

	return { scripts: scriptsToRun, matchedFiles };
}

/**
 * Executes a single npm script using `spawn`.
 * @param script The name of the npm script to run.
 */
function executeScript(executable: Executable): Promise<void> {
	return new Promise((resolve, reject) => {
		const displayScript =
			typeof executable === "string"
				? executable
				: `${executable.script} ${executable.args.join(" ")}`;
		logger.info(`Running script: ${displayScript}`);

		let child: ChildProcess;
		if (typeof executable === "string") {
			// The entire script string (command + args) is passed to `npm run`.
			// `shell: true` allows the shell to parse the command and its arguments.
			child = spawn("npm", ["run", executable], {
				stdio: "inherit",
				shell: true,
			});
		} else {
			// Optimization: Avoid shell spawn by passing arguments directly.
			// This is faster and avoids issues with unquoted arguments.
			child = spawn("npm", ["run", executable.script, ...executable.args], {
				stdio: "inherit",
				shell: false,
			});
		}

		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				// Reject the promise if the script fails
				reject(new Error(`Script "${displayScript}" exited with code ${code}`));
			}
		});

		child.on("error", (err) => {
			reject(err);
		});
	});
}

/**
 * Runs the configured scripts for a given git hook.
 * @param hookName The name of the git hook being triggered.
 * @returns A promise that resolves to `true` if the hook succeeds, `false` otherwise.
 */
export async function runHook(hookName: KebabCaseGitHook): Promise<boolean> {
	const config = await loadConfig();
	if (!config) {
		logger.error("Configuration file not found.");
		return false;
	}

	const hookConfig = config[kebabToCamel(hookName) as CamelCaseGitHook];
	if (!hookConfig || Object.keys(hookConfig).length === 0) {
		return true; // No configuration for this hook, so it's a success
	}

	// Optimization: Only fetch staged files if the hook configuration needs them.
	// Glob-based hooks need them for matching.
	// Simple hooks only need them if they use a custom argument function.
	const stagedFiles = shouldFetchStagedFiles(hookConfig)
		? await getStagedFiles()
		: [];

	const { scripts: finalScripts, matchedFiles } = await resolveScriptsToRun(
		hookConfig,
		stagedFiles,
	);

	if (finalScripts.length === 0) {
		logger.info(`No scripts to run for ${hookName}.`);
		return true;
	}

	let stashCreated = false;

	// Optimization: Skip stashing for hooks that don't need a clean working directory.
	// Hooks like commit-msg only check metadata and don't touch project files.
	// Post-hooks run after the action, so stashing is unnecessary overhead.
	const hooksSkippingStash: string[] = [
		"commit-msg",
		"prepare-commit-msg",
		"post-commit",
		"post-checkout",
		"post-merge",
		"post-rewrite",
	];

	try {
		// 1. Stash unstaged changes if they exist
		if (!hooksSkippingStash.includes(hookName)) {
			stashCreated = await stashPushKeepIndex();
			if (stashCreated) {
				logger.info("Stashed unstaged changes.");
			}
		}

		// 2. Run the scripts
		logger.info(`Running scripts for ${hookName}...`);
		// Use Promise.all to ensure that if any script fails, the entire hook fails.
		await Promise.all(finalScripts.map((script) => executeScript(script)));

		// 3. For pre-commit, stage any changes made by the scripts
		if (hookName === "pre-commit") {
			// Optimization: For glob-based hooks, only check for changes in files that matched the globs.
			// This avoids scanning the entire working directory with `git status` which can be slow.
			const changedFiles = await getChangedFiles(matchedFiles ?? undefined);
			if (changedFiles.length > 0) {
				logger.info("Adding modified files to the index...");
				await addFiles(changedFiles);
			}
		}

		logger.success(`${hookName} hook passed.`);
		return true;
	} catch (error: unknown) {
		logger.error(`An error occurred during the ${hookName} hook.`);
		if (error instanceof Error && error.message) {
			// Don't log the full error object, just the message for cleaner output.
			logger.error(error.message);
		}
		return false;
	} finally {
		// 4. Pop the stash if one was created
		if (stashCreated) {
			try {
				logger.info("Restoring unstaged changes...");
				await stashPop();
			} catch (_stashError) {
				logger.error(
					`CRITICAL: Failed to restore unstaged changes. Please resolve conflicts manually.`,
				);
				// This is a critical failure, we need to inform the user and exit
				process.exit(1);
			}
		}
	}
}
