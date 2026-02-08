import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
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
	evacuateFiles,
	getChangedFiles,
	getGitStatus,
	getStagedFiles,
	restoreFiles,
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
	// Optimization: For commands without arguments, we can split faster.
	if (!command.includes(" ")) {
		return extraArgs.length > 0
			? { script: command, args: extraArgs }
			: { script: command, args: [] };
	}

	const parts = command.split(/\s+/).filter((part) => part !== "");
	const script = parts[0];
	const args =
		extraArgs.length > 0 ? [...parts.slice(1), ...extraArgs] : parts.slice(1);

	return { script, args };
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
	// Optimization: Use a Map for O(1) lookups during command grouping.
	const batchedCommands = new Map<
		string,
		{ command: Command<string>; files: Set<string> }
	>();

	// WeakMap to assign unique IDs to functions for O(1) command comparison keys.
	// We keep this local to the function as it's only needed for a single resolution pass.
	const functionIds = new WeakMap<ArgsFn, number>();
	let nextFunctionId = 0;

	const getCommandKey = (command: Command<string>): string => {
		if (typeof command === "string") {
			return `s:${command}`;
		}
		let id = functionIds.get(command[1]);
		if (id === undefined) {
			id = nextFunctionId++;
			functionIds.set(command[1], id);
		}
		return `t:${command[0]}:${id}`;
	};

	const processListOfCommands = (
		commands: Command<string>[],
		files: string[],
	) => {
		for (const command of commands) {
			const key = getCommandKey(command);
			let batch = batchedCommands.get(key);
			if (!batch) {
				batch = { command, files: new Set() };
				batchedCommands.set(key, batch);
			}
			// Add all files to the batch's file set
			for (const file of files) {
				batch.files.add(file);
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
			if (!micromatch) {
				throw new Error("Failed to load micromatch");
			}
			const mm = micromatch;

			const patterns = Object.keys(hookConfig);
			// 1. Get all matched files for the pre-commit optimization in a single pass
			matchedFiles = mm(stagedFiles, patterns, {
				matchBase: true,
			});

			if (matchedFiles.length > 0) {
				// Optimization: If there's only one pattern, matchedFiles is already our result.
				if (patterns.length === 1) {
					const command = getCommands(hookConfig[patterns[0]]);
					processListOfCommands(command, matchedFiles);
				} else {
					// 2. Group patterns by command to minimize micromatch calls.
					// Use Map with string keys for O(1) lookup.
					const keyToPatterns = new Map<string, string[]>();
					const keyToCommand = new Map<string, Command<string>>();

					// Pre-calculate all commands and their keys
					const patternToCommands = new Map<
						string,
						{ key: string; command: Command<string> }[]
					>();
					for (const pattern of patterns) {
						const commands = getCommands(hookConfig[pattern]);
						const cmdList = commands.map((command) => ({
							key: getCommandKey(command),
							command,
						}));
						patternToCommands.set(pattern, cmdList);
					}

					for (const [pattern, cmdList] of patternToCommands) {
						for (const { key, command } of cmdList) {
							if (!keyToCommand.has(key)) {
								keyToCommand.set(key, command);
							}

							let patternList = keyToPatterns.get(key);
							if (!patternList) {
								patternList = [];
								keyToPatterns.set(key, patternList);
							}
							patternList.push(pattern);
						}
					}

					// 3. Run micromatch for each unique command group
					for (const [key, patternsForCommand] of keyToPatterns) {
						const command = keyToCommand.get(key);
						if (!command) continue;

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
	}
	// Case 2: Unconditional configuration
	else {
		const commandsToProcess = getCommands(hookConfig);
		processListOfCommands(commandsToProcess, stagedFiles ?? []);
	}

	for (const batch of batchedCommands.values()) {
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
 * Safely restores stash and evacuated files with specified error handling strategy.
 * @param options Configuration for restoration behavior.
 */
async function safeRestore(options: {
	stashCreated: boolean;
	evacuatedDir: string | null;
	silent?: boolean;
}): Promise<void> {
	const { stashCreated, evacuatedDir, silent = false } = options;
	const errors: { error: unknown; message: string }[] = [];

	const tasks: Promise<void>[] = [];

	// Restoration must be careful. We attempt both in parallel.
	// We use separate try-catch blocks to ensure one failure doesn't block the other.

	if (stashCreated) {
		tasks.push(
			(async () => {
				try {
					if (!silent) {
						logger.info("Restoring unstaged changes from stash...");
					}
					await stashPop();
				} catch (error) {
					errors.push({
						error,
						message:
							"CRITICAL: Failed to restore unstaged changes from stash. Please resolve conflicts manually using 'git stash pop'.",
					});
				}
			})(),
		);
	}

	if (evacuatedDir) {
		tasks.push(
			(async () => {
				try {
					if (!silent) {
						logger.info("Restoring untracked files from backup...");
					}
					await restoreFiles(evacuatedDir);
				} catch (error) {
					errors.push({
						error,
						message:
							`CRITICAL: Failed to restore untracked files from backup directory: ${evacuatedDir}\n` +
							"The files are still safely backed up in that directory. Please restore them manually.",
					});
				}
			})(),
		);
	}

	if (tasks.length > 0) {
		await Promise.all(tasks);
	}

	if (errors.length > 0 && !silent) {
		for (const { error, message } of errors) {
			logger.error(message);
			if (error instanceof Error && error.message) {
				logger.error(`Error details: ${error.message}`);
			}
		}
		process.exit(1);
	}
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

	// Optimization: Start all necessary git checks.
	// We use getGitStatus to combine multiple checks into a single process spawn when possible.
	const needsStagedFiles = shouldFetchStagedFiles(hookConfig);
	const needsStash = !hooksSkippingStash.has(hookName);

	const [stagedFiles, untrackedItems, unstagedChangesExist] =
		await (async () => {
			if (needsStash) {
				const status = await getGitStatus();
				return [
					status.stagedFiles,
					status.untrackedItems,
					status.unstagedChangesExist,
				] as const;
			}
			if (needsStagedFiles) {
				const staged = await getStagedFiles();
				return [staged, [], false] as const;
			}
			return [[], [], false] as const;
		})();

	const { scripts: finalScripts, matchedFiles } = await resolveScriptsToRun(
		hookConfig,
		stagedFiles,
	);

	if (finalScripts.length === 0) {
		logger.info(`No scripts to run for ${hookName}.`);
		return true;
	}

	let stashCreated = false;
	let evacuatedDir: string | null = null;
	let restorationCalled = false;

	/**
	 * Guarded restoration function to ensure it only runs once.
	 */
	const performRestoration = async (silent = false) => {
		if (restorationCalled) return;
		restorationCalled = true;
		await safeRestore({ stashCreated, evacuatedDir, silent });
	};

	const onSigInt = () => onSignal(130);
	const onSigTerm = () => onSignal(143);

	// Register signal handlers for robust restoration (Failure-safe requirement)
	async function onSignal(code: number) {
		await performRestoration(true);
		process.exit(code);
	}

	process.on("SIGINT", onSigInt);
	process.on("SIGTERM", onSigTerm);

	try {
		// Hybrid Stashing Implementation:
		if (needsStash) {
			const stashTasks: Promise<void>[] = [];

			// 2. Untracked Files (Physical Backup)
			if (untrackedItems.length > 0) {
				evacuatedDir = join(
					".git",
					"ts-git-hooks",
					"backups",
					`${process.pid}_${Date.now()}`,
				);
				stashTasks.push(
					evacuateFiles(untrackedItems, evacuatedDir).then(() => {
						logger.info(
							`Evacuated ${untrackedItems.length} untracked items to physical backup.`,
						);
					}),
				);
			}

			// 3. Tracked Files (Conditional git stash)
			// Check whether there are unstaged tracked changes.
			if (unstagedChangesExist) {
				// Only if unstaged changes exist: Run git stash push --keep-index
				stashTasks.push(
					stashPushKeepIndex().then((created) => {
						stashCreated = created;
						if (stashCreated) {
							logger.info("Stashed unstaged tracked changes.");
						}
					}),
				);
			}

			if (stashTasks.length > 0) {
				await Promise.all(stashTasks);
			}
		}

		// 4. Hook Execution
		logger.info(`Running scripts for ${hookName}...`);
		await Promise.all(finalScripts.map((script) => executeScript(script)));

		// 5. For pre-commit, stage any changes made by the scripts
		if (hookName === "pre-commit") {
			const changedFiles = await getChangedFiles(matchedFiles ?? undefined);
			if (changedFiles.length > 0) {
				logger.info("Adding modified files to the index...");
				await addFiles(changedFiles, true);
			}
		}

		logger.success(`${hookName} hook passed.`);
		return true;
	} catch (error: unknown) {
		logger.error(`An error occurred during the ${hookName} hook.`);
		if (error instanceof Error && error.message) {
			logger.error(error.message);
		}
		return false;
	} finally {
		// Remove signal handlers to avoid memory leaks and double restoration
		process.off("SIGINT", onSigInt);
		process.off("SIGTERM", onSigTerm);

		// 6. Restoration (MUST be failure-safe)
		await performRestoration(false);
	}
}
