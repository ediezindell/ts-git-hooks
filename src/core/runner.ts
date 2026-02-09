import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Options } from "micromatch";
import type {
	ArgsFn,
	CamelCaseGitHook,
	Command,
	GlobHookConfig,
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
import { isGlobHookConfig, isHookConfigWithOpts, loadConfig } from "./config";

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

	// For simple commands without quotes, we can parse them into script and args
	// to avoid shell overhead if it's not a glob hook or if no files matched.
	if (!hasQuotes) {
		const extraArgs = isGlob ? files : [];
		return parseSimpleCommand(commandString, extraArgs);
	}

	// For commands with quotes, we generally return them as-is to be executed via shell.
	// However, for glob-based hooks, we must append the matched files.
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
 * Groups patterns by command to minimize micromatch calls and redundant processing.
 */
function groupPatternsByCommand(
	patterns: string[],
	hookConfig: HookConfig,
	getCommandKey: (command: Command<string>) => string,
): {
	keyToPatterns: Map<string, string[]>;
	keyToCommand: Map<string, Command<string>>;
} {
	const keyToPatterns = new Map<string, string[]>();
	const keyToCommand = new Map<string, Command<string>>();

	// At this point, hookConfig is guaranteed to be a GlobHookConfig.
	const globConfig = hookConfig as GlobHookConfig<string>;

	for (const pattern of patterns) {
		const commands = getCommands(globConfig[pattern]);
		for (const command of commands) {
			const key = getCommandKey(command);
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

	return { keyToPatterns, keyToCommand };
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
	const batchedCommands = new Map<
		string,
		{ command: Command<string>; files: Set<string> }
	>();

	// WeakMap to assign unique IDs to functions for O(1) command comparison keys.
	const functionIds = new WeakMap<ArgsFn, number>();
	let nextFunctionId = 0;

	const getCommandKey = (command: Command<string>): string => {
		if (typeof command === "string") return `s:${command}`;
		let id = functionIds.get(command[1]);
		if (id === undefined) {
			id = nextFunctionId++;
			functionIds.set(command[1], id);
		}
		return `t:${command[0]}:${id}`;
	};

	const addCommandBatch = (commands: Command<string>[], files: string[]) => {
		for (const command of commands) {
			const key = getCommandKey(command);
			let batch = batchedCommands.get(key);
			if (!batch) {
				batch = { command, files: new Set(files) };
				batchedCommands.set(key, batch);
			} else {
				for (const file of files) batch.files.add(file);
			}
		}
	};

	let matchedFiles: string[] | null = null;
	const isGlob = isGlobHookConfig(hookConfig);

	if (isGlob) {
		if (stagedFiles && stagedFiles.length > 0) {
			// Optimization: Lazy load and cache micromatch only when needed
			if (!micromatch) micromatch = (await import("micromatch")).default;
			if (!micromatch) throw new Error("Failed to load micromatch");
			const mm = micromatch;

			const patterns = Object.keys(hookConfig);
			matchedFiles = mm(stagedFiles, patterns, { matchBase: true });

			if (matchedFiles.length > 0) {
				if (patterns.length === 1) {
					addCommandBatch(getCommands(hookConfig[patterns[0]]), matchedFiles);
				} else {
					const { keyToPatterns, keyToCommand } = groupPatternsByCommand(
						patterns,
						hookConfig,
						getCommandKey,
					);

					const micromatchCache = new Map<string, string[]>();

					for (const [key, patternsForCommand] of keyToPatterns) {
						const command = keyToCommand.get(key);
						if (!command) continue;

						const cacheKey = patternsForCommand.join("\0");
						let matchingFiles = micromatchCache.get(cacheKey);

						if (matchingFiles === undefined) {
							matchingFiles =
								patternsForCommand.length === patterns.length
									? matchedFiles
									: mm(matchedFiles, patternsForCommand, { matchBase: true });
							micromatchCache.set(cacheKey, matchingFiles);
						}

						if (matchingFiles.length > 0)
							addCommandBatch([command], matchingFiles);
					}
				}
			}
		}
	} else {
		// Optimization: For simple hooks, bypass grouping logic completely.
		const commandsToProcess = getCommands(hookConfig);
		const files = stagedFiles ?? [];
		for (const command of commandsToProcess) {
			scriptsToRun.push(processCommand(command, files, false));
		}
		return { scripts: scriptsToRun, matchedFiles };
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
 * @param executable The executable command to run.
 */
function executeScript(executable: Executable): Promise<void> {
	return new Promise((resolve, reject) => {
		const isStringExecutable = typeof executable === "string";

		const displayScript = isStringExecutable
			? executable
			: `${executable.script} ${executable.args.join(" ")}`;

		logger.info(`Running script: ${displayScript}`);

		const packageManager = getPackageManager();

		let spawnArgs: string[];
		let useShell: boolean;

		if (isStringExecutable) {
			// The entire script string (command + args) is passed to `npm run` (or pnpm/yarn).
			// `shell: true` allows the shell to parse the command and its arguments.
			spawnArgs = ["run", executable];
			useShell = true;
		} else {
			// Optimization: Avoid shell spawn by passing arguments directly.
			// This is faster and avoids issues with unquoted arguments.
			spawnArgs = ["run", executable.script, ...executable.args];
			useShell = false;
		}

		const child = spawn(packageManager, spawnArgs, {
			stdio: "inherit",
			shell: useShell,
		});

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
 * Determines the Git status (staged, untracked, unstaged) based on the hook configuration and current environment.
 */
async function determineGitStatus(
	_needsStash: boolean,
	needsStagedFiles: boolean,
	initialGitStatus: {
		stagedFiles: string[];
		untrackedItems: string[];
		unstagedChangesExist: boolean;
	} | null,
): Promise<{
	stagedFiles: string[];
	untrackedItems: string[];
	unstagedChangesExist: boolean;
}> {
	// If we already fetched status (because needsStash was true), return it
	if (initialGitStatus) {
		return initialGitStatus;
	}

	// If we didn't fetch status yet (needsStash was false), but we need staged files (e.g. glob hook in commit-msg?)
	if (needsStagedFiles) {
		const staged = await getStagedFiles();
		return {
			stagedFiles: staged,
			untrackedItems: [],
			unstagedChangesExist: false,
		};
	}

	return { stagedFiles: [], untrackedItems: [], unstagedChangesExist: false };
}

/**
 * Registers signal handlers for SIGINT and SIGTERM to ensure cleanup is performed.
 * @returns A cleanup function to remove the handlers.
 */
function registerSignalHandlers(onSignal: (code: number) => void): () => void {
	const onSigInt = () => onSignal(130);
	const onSigTerm = () => onSignal(143);

	process.on("SIGINT", onSigInt);
	process.on("SIGTERM", onSigTerm);

	return () => {
		process.off("SIGINT", onSigInt);
		process.off("SIGTERM", onSigTerm);
	};
}

/**
 * Performs "Hybrid Stashing": backs up untracked files physically and stashes tracked unstaged changes.
 */
async function performHybridStashing(
	untrackedItems: string[],
	unstagedChangesExist: boolean,
): Promise<{ evacuatedDir: string | null; stashCreated: boolean }> {
	let evacuatedDir: string | null = null;
	let stashCreated = false;
	const stashTasks: Promise<void>[] = [];

	// 1. Untracked Files (Physical Backup)
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

	// 2. Tracked Files (Conditional git stash)
	if (unstagedChangesExist) {
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

	return { evacuatedDir, stashCreated };
}

/**
 * Runs the configured scripts for a given git hook.
 * @param hookName The name of the git hook being triggered.
 * @returns A promise that resolves to `true` if the hook succeeds, `false` otherwise.
 */
export async function runHook(hookName: KebabCaseGitHook): Promise<boolean> {
	// Optimization: Start checking git status immediately if we know we'll likely need it (e.g. pre-commit)
	const needsStash = !hooksSkippingStash.has(hookName);

	const [config, initialGitStatus] = await Promise.all([
		loadConfig(),
		needsStash ? getGitStatus() : Promise.resolve(null),
	]);

	if (!config) {
		logger.error("Configuration file not found.");
		return false;
	}

	const rawHookConfig = config[kebabToCamel(hookName) as CamelCaseGitHook];
	if (!rawHookConfig) {
		return true; // No configuration for this hook
	}

	let hookConfig: HookConfig;
	let isSequential = config.sequential ?? false;

	if (isHookConfigWithOpts(rawHookConfig)) {
		hookConfig = rawHookConfig.config;
		if (rawHookConfig.sequential !== undefined) {
			isSequential = rawHookConfig.sequential;
		}
	} else {
		hookConfig = rawHookConfig as HookConfig;
	}

	if (Object.keys(hookConfig).length === 0) {
		return true;
	}

	// Determine if we need staged files based on the now-loaded config
	const needsStagedFiles = shouldFetchStagedFiles(hookConfig);

	const { stagedFiles, untrackedItems, unstagedChangesExist } =
		await determineGitStatus(needsStash, needsStagedFiles, initialGitStatus);

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

	const performRestoration = async (silent = false) => {
		if (restorationCalled) return;
		restorationCalled = true;
		await safeRestore({ stashCreated, evacuatedDir, silent });
	};

	const unregister = registerSignalHandlers(async (code) => {
		await performRestoration(true);
		process.exit(code);
	});

	try {
		if (needsStash) {
			const result = await performHybridStashing(
				untrackedItems,
				unstagedChangesExist,
			);
			stashCreated = result.stashCreated;
			evacuatedDir = result.evacuatedDir;
		}

		logger.info(
			`Running scripts for ${hookName} (${isSequential ? "sequentially" : "in parallel"})...`,
		);

		if (isSequential) {
			for (const script of finalScripts) {
				await executeScript(script);
			}
		} else {
			await Promise.all(finalScripts.map((script) => executeScript(script)));
		}

		// For pre-commit, stage any changes made by the scripts
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
		unregister();
		await performRestoration(false);
	}
}
