import { type ChildProcess, spawn } from "node:child_process";
import type { Options } from "micromatch";
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
import { getPackageManager } from "../utils/packageManager";
import { kebabToCamel } from "../utils/string";
import { isGlobHookConfig, loadConfig } from "./config";

/**
 * Represents an executable command.
 * Can be a simple string (handled via shell) or an object with split arguments (handled directly).
 */
export type Executable = string | { script: string; args: string[] };

/**
 * Type guard to check if a command is a tuple [script, ArgsFn].
 */
function isCommandTuple(value: unknown): value is [string, ArgsFn] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "string" &&
		typeof value[1] === "function"
	);
}

/**
 * Parses a simple command string into a split Executable object.
 * Appends extra arguments (e.g. file paths) if provided.
 */
function parseSimpleCommand(
	command: string,
	extraArgs: string[] = [],
): Executable {
	// Optimization: Split simple commands to avoid shell spawn.
	// This works for "test", "lint --fix", etc.
	const parts = command.split(/\s+/).filter(Boolean);
	const script = parts[0];
	const args = parts.slice(1);

	if (extraArgs.length > 0) {
		args.push(...extraArgs);
	}

	return { script, args };
}

/**
 * Processes a command, resolving it to a final Executable.
 * @param command The command to process.
 * @param files The list of files to pass to the command.
 * @returns The resolved Executable.
 */
function isCommandTuple(value: unknown): value is [string, ArgsFn] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "string" &&
		typeof value[1] === "function"
	);
}

function processCommand(
	command: Command<string>,
	files: string[],
	isGlob: boolean,
): Executable {
	if (isCommandTuple(command)) {
		// Command is a tuple: [script, formatArguments]
		const [script, formatArguments] = command;
		return formatArguments(files, script);
	}

	// At this point, command is definitely a string (not a tuple).
	const commandString = command as string;
	const hasQuotes = commandString.includes('"') || commandString.includes("'");

	if (!hasQuotes) {
		return parseSimpleCommand(commandString, isGlob ? files : []);
	}

	// For glob-based hooks with quotes, we must construct a single string
	// because returning an object would treat the whole commandString as the script name
	// (which fails if it has spaces/quotes).
	if (isGlob && files.length > 0) {
		// We must quote the files because they are being interpolated into a shell command string.
		// JSON.stringify is a safe enough way to quote filenames for shell (adds double quotes).
		const quotedFiles = files.map((f) => JSON.stringify(f)).join(" ");
		return `${commandString} ${quotedFiles}`;
	}

	return commandString;
}

/**
 * Normalizes a script configuration into a consistent array of commands.
 * @param script The script configuration to process.
 * @returns An array of commands.
 */
const getCommands = (script: Script<string>): Command<string>[] => {
	if (isCommandTuple(script)) {
		return [script];
	}
	if (Array.isArray(script)) {
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
	if (isGlobHookConfig(hookConfig)) {
		return true;
	}

	// For simple hooks, check if any command uses a custom argument function.
	const commands = getCommands(hookConfig);
	return commands.some(isCommandTuple);
}

/**
 * Checks if two commands are equal.
 * Equality is defined as:
 * - Both are identical references or identical strings.
 * - Both are tuples with identical script name and function reference.
 */
function areCommandsEqual(a: Command<string>, b: Command<string>): boolean {
	if (a === b) {
		return true;
	}
	if (typeof a === "string" && typeof b === "string") {
		return a === b;
	}
	if (isCommandTuple(a) && isCommandTuple(b)) {
		return a[0] === b[0] && a[1] === b[1];
	}
	return false;
}

// Cache for the micromatch module to avoid repeated dynamic imports.
let micromatch:
	| ((
			list: string[],
			patterns: string | string[],
			options?: Options,
	  ) => string[])
	| undefined;

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
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i];
			let batch = batchedCommands.find((b) =>
				areCommandsEqual(b.command, command),
			);
			if (!batch) {
				batch = { command, files: new Set() };
				batchedCommands.push(batch);
			}
			const batchFiles = batch.files;
			for (let j = 0; j < files.length; j++) {
				batchFiles.add(files[j]);
			}
		}
	};

	let matchedFiles: string[] | null = null;
	const isGlob = isGlobHookConfig(hookConfig);

	if (isGlob) {
		if (stagedFiles && stagedFiles.length > 0) {
			// Optimization: Lazy load and cache micromatch only when needed
			if (!micromatch) {
				micromatch = (await import("micromatch")).default;
			}
			const mm = micromatch!;

			const patterns = Object.keys(hookConfig);
			// 1. Get all matched files for the pre-commit optimization in a single pass
			matchedFiles = mm(stagedFiles, patterns, {
				matchBase: true,
			});

			if (matchedFiles.length > 0) {
				// 2. Group patterns by command to minimize micromatch calls
				const commandToPatterns = new Map<Command<string>, string[]>();
				const uniqueCommands: Command<string>[] = [];

				for (const [pattern, script] of Object.entries(hookConfig)) {
					const commands = getCommands(script);
					for (const command of commands) {
						let existingCommand = uniqueCommands.find((c) =>
							areCommandsEqual(c, command),
						);
						if (!existingCommand) {
							existingCommand = command;
							uniqueCommands.push(existingCommand);
						}

						let patternList = commandToPatterns.get(existingCommand);
						if (!patternList) {
							patternList = [];
							commandToPatterns.set(existingCommand, patternList);
						}
						patternList.push(pattern);
					}
				}

				// 3. Run micromatch for each unique command group
				for (const command of uniqueCommands) {
					const patternsForCommand = commandToPatterns.get(command) ?? [];
					// Optimization: Use matchedFiles instead of stagedFiles.
					// Since matchedFiles is the subset of stagedFiles that matched ANY pattern,
					// any file matching patternsForCommand MUST be in matchedFiles.
					const matchingFiles = mm(matchedFiles, patternsForCommand, {
						matchBase: true,
					});

					if (matchingFiles.length > 0) {
						processListOfCommands([command], matchingFiles);
					}
				}
			}
		}
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

		const packageManager = getPackageManager();
		let child: ChildProcess;

		if (typeof executable === "string") {
			// The entire script string (command + args) is passed to `npm run` (or pnpm/yarn).
			// `shell: true` allows the shell to parse the command and its arguments.
			child = spawn(packageManager, ["run", executable], {
				stdio: "inherit",
				shell: true,
			});
		} else {
			// Optimization: Avoid shell spawn by passing arguments directly.
			// This is faster and avoids issues with unquoted arguments.
			child = spawn(
				packageManager,
				["run", executable.script, ...executable.args],
				{
					stdio: "inherit",
					shell: false,
				},
			);
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

// Optimization: A Set provides faster O(1) lookups compared to Array.prototype.includes O(n).
const hooksSkippingStash: Set<string> = new Set([
	"commit-msg",
	"prepare-commit-msg",
	"post-commit",
	"post-checkout",
	"post-merge",
	"post-rewrite",
]);

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
	try {
		// 1. Stash unstaged changes if they exist
		if (!hooksSkippingStash.has(hookName)) {
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
