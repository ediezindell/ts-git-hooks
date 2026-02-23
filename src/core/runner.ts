import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Options } from "micromatch";
import { parse, quote } from "shell-quote";
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
	rollbackToPreCommitState,
	saveIndexState,
	stashApply,
	stashCreate,
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
 * Parses a command string into arguments and detects shell operators.
 */
function parseCommandLine(cmd: string): { args: string[]; hasOperators: boolean } {
	const parsed = parse(cmd);
	const args: string[] = [];
	let hasOperators = false;

	for (const entry of parsed) {
		if (typeof entry === "string") {
			args.push(entry);
		} else {
			hasOperators = true;
			break;
		}
	}

	return { args, hasOperators };
}

/**
 * Processes a command into an Executable.
 * Uses shell-quote for robust parsing and handles both string and tuple commands.
 */
function processCommand(
	command: Command<string>,
	files: string[],
	isGlob: boolean,
): Executable {
	if (isCommandTuple(command)) {
		const [script, formatArguments] = command;
		const result = formatArguments(files, script);
		const { args, hasOperators } = parseCommandLine(result);

		if (hasOperators) {
			// If it has shell operators, we fallback to string execution.
			// executeScript will prepend the package manager and 'run'.
			return result;
		}

		// If the first parsed arg is the script name, we use it.
		// Otherwise, we assume the result is arguments for the script from the tuple.
		if (args.length > 0 && args[0] === script) {
			return { script, args: args.slice(1) };
		}
		return { script, args };
	}

	const commandString = command as string;
	const { args, hasOperators } = parseCommandLine(commandString);

	// If there are shell operators, we must use shell: true.
	// To fix the security vulnerability, we safely quote files before appending.
	if (hasOperators) {
		if (isGlob && files.length > 0) {
			return `${commandString} ${quote(files)}`;
		}
		return commandString;
	}

	if (args.length === 0) {
		return { script: "", args: isGlob ? files : [] };
	}

	return {
		script: args[0],
		args: [...args.slice(1), ...(isGlob ? files : [])],
	};
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

		const label = isStringExecutable
			? executable.split(" ")[0]
			: executable.script;

		const scopedLogger = logger.scope(label);

		const displayScript = isStringExecutable
			? executable
			: `${executable.script} ${executable.args.join(" ")}`;

		scopedLogger.info(`Running script: ${displayScript}`);

		const packageManager = getPackageManager();

		let command: string;
		let spawnArgs: string[] | undefined;
		let useShell: boolean;

		if (isStringExecutable) {
			// The entire script string (command + args) is passed to `npm run` (or pnpm/yarn).
			// To avoid Node.js DeprecationWarning (DEP0190), when using shell: true,
			// we should either pass the command as a single string.
			command = `${packageManager} run ${executable}`;
			spawnArgs = undefined;
			useShell = true;
		} else {
			// Optimization: Avoid shell spawn by passing arguments directly.
			// This is faster and avoids issues with unquoted arguments.
			command = packageManager;
			spawnArgs = ["run", executable.script, ...executable.args];
			useShell = false;
		}

		// When useShell is true, spawnArgs is undefined, so we only pass the command string.
		const child = spawnArgs
			? spawn(command, spawnArgs, { stdio: "inherit", shell: useShell })
			: spawn(command, { stdio: "inherit", shell: useShell });

		child.on("close", (code) => {
			if (code === 0) {
				scopedLogger.success("Script passed.");
				resolve();
			} else {
				// Reject the promise if the script fails
				reject(new Error(`Script "${displayScript}" exited with code ${code}`));
			}
		});

		child.on("error", (err) => {
			scopedLogger.error(err);
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
 *
 * On hook failure: always rolls back index/working tree to origIndexTree first (undoing any
 * partial linter changes even when there were no unstaged changes), then applies the stash.
 *
 * On hook success: applies stash directly; if that conflicts, rolls back to origIndexTree
 * and retries. Either way, the working directory is restored to the pre-commit state.
 *
 * @param options Configuration for restoration behavior.
 */
async function safeRestore(options: {
	stashHash: string | null;
	evacuatedDir: string | null;
	origIndexTree: string | null;
	hookSucceeded: boolean;
	silent?: boolean;
}): Promise<void> {
	const {
		stashHash,
		evacuatedDir,
		origIndexTree,
		hookSucceeded,
		silent = false,
	} = options;
	const errors: { error: unknown; message: string }[] = [];

	const tasks: Promise<void>[] = [];

	// Stash/rollback task — must run sequentially (rollback before stash apply when needed).
	// Independent of evacuated-file restoration, so both tasks run in parallel.
	const needsRollback = !hookSucceeded && origIndexTree !== null;
	if (needsRollback || stashHash) {
		tasks.push(
			(async () => {
				// Step 1: On hook failure, rollback to origIndexTree to undo any linter changes
				// from the working tree and index — even when there are no unstaged changes.
				if (needsRollback) {
					try {
						if (!silent) {
							logger.info("Rolling back to pre-commit state...");
						}
						await rollbackToPreCommitState(origIndexTree as string);
					} catch (rollbackError) {
						errors.push({
							error: rollbackError,
							message:
								"CRITICAL: Rollback to pre-commit state failed.\n" +
								"Your working directory may be in an inconsistent state.",
						});
						return; // Cannot safely apply stash if rollback failed
					}
				}

				if (!stashHash) return;

				// Step 2: Apply the stash. After a failure-path rollback we are back at ORIG_TREE,
				// so the stash (which was created from ORIG_TREE + unstaged) should apply cleanly.
				try {
					if (!silent) {
						logger.info("Restoring unstaged changes from stash...");
					}
					await stashApply(stashHash);
				} catch (firstError) {
					// Stash apply failed. This can happen on the success path (LINT_TREE conflicts
					// with unstaged changes). Roll back to ORIG_TREE and retry.
					if (origIndexTree && hookSucceeded) {
						try {
							if (!silent) {
								logger.info(
									"Stash apply failed. Rolling back to pre-commit state and retrying...",
								);
							}
							await rollbackToPreCommitState(origIndexTree);
							await stashApply(stashHash);
							// Rollback succeeded and stash was applied, but linter's staged changes
							// are now gone. Abort the commit so the user can re-run it.
							errors.push({
								error: firstError,
								message:
									"git stash apply failed (conflicts with formatter changes).\n" +
									"Rolled back to pre-commit state. Please re-run the commit.",
							});
						} catch (retryError) {
							// Rollback succeeded but stash still cannot be applied.
							// Promote the stash to refs/stash for manual recovery.
							await rollbackToPreCommitState(origIndexTree, stashHash).catch(
								() => {},
							);
							errors.push({
								error: retryError,
								message:
									"CRITICAL: Stash apply failed even after rollback.\n" +
									"Rolled back to pre-commit state (staged changes only).\n" +
									"Your unstaged changes are saved in stash@{0} — run 'git stash pop' to restore them.",
							});
						}
					} else {
						// No origIndexTree to roll back to (or already rolled back on failure path).
						// Promote the stash to refs/stash if possible.
						if (origIndexTree) {
							await rollbackToPreCommitState(origIndexTree, stashHash).catch(
								() => {},
							);
						}
						errors.push({
							error: firstError,
							message:
								"CRITICAL: Failed to restore unstaged changes from stash.\n" +
								(origIndexTree
									? "Rolled back to pre-commit state.\n" +
										"Your unstaged changes are saved in stash@{0} — run 'git stash pop' to restore them."
									: "Please resolve conflicts manually using 'git stash pop'."),
						});
					}
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
 * Uses git stash create to avoid polluting the user's stash history (refs/stash is not updated).
 */
async function performHybridStashing(
	untrackedItems: string[],
	unstagedChangesExist: boolean,
): Promise<{ evacuatedDir: string | null; stashHash: string | null }> {
	let evacuatedDir: string | null = null;
	let stashHash: string | null = null;
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

	// 2. Tracked Files (Conditional git stash create — does not update refs/stash)
	if (unstagedChangesExist) {
		stashTasks.push(
			stashCreate().then((hash) => {
				stashHash = hash;
				if (stashHash) {
					logger.info("Stashed unstaged tracked changes.");
				}
			}),
		);
	}

	if (stashTasks.length > 0) {
		await Promise.all(stashTasks);
	}

	return { evacuatedDir, stashHash };
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

	// Defense-in-depth: Filter stagedFiles to only include existing files.
	// This prevents tools from failing if a deleted file somehow slipped into the list.
	const existingStagedFiles = (
		await Promise.all(
			stagedFiles.map(async (file) => {
				try {
					await stat(file);
					return file;
				} catch {
					return null;
				}
			}),
		)
	).filter((f): f is string => f !== null);

	const { scripts: finalScripts, matchedFiles } = await resolveScriptsToRun(
		hookConfig,
		existingStagedFiles,
	);

	if (finalScripts.length === 0) {
		logger.info(`No scripts to run for ${hookName}.`);
		return true;
	}

	let stashHash: string | null = null;
	let evacuatedDir: string | null = null;
	let origIndexTree: string | null = null;
	let hookSucceeded = false;
	let restorationCalled = false;

	const performRestoration = async (silent = false) => {
		if (restorationCalled) return;
		restorationCalled = true;
		await safeRestore({
			stashHash,
			evacuatedDir,
			origIndexTree,
			hookSucceeded,
			silent,
		});
	};

	const unregister = registerSignalHandlers(async (code) => {
		await performRestoration(true);
		process.exit(code);
	});

	try {
		if (needsStash) {
			// Save index state before stashing to enable full rollback on stash apply failure
			origIndexTree = await saveIndexState();
			const result = await performHybridStashing(
				untrackedItems,
				unstagedChangesExist,
			);
			stashHash = result.stashHash;
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

		hookSucceeded = true;
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
