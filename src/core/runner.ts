import { spawn } from "node:child_process";
import micromatch from "micromatch";
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
	hasUnstagedChanges,
	stashPop,
	stashPushKeepIndex,
} from "../utils/git";
import { kebabToCamel } from "../utils/string";
import { loadConfig } from "./config";

/**
 * Processes a command, resolving it to a final script string.
 * @param command The command to process.
 * @param files The list of files to pass to the command.
 * @returns The resolved script string.
 */
function processCommand(
	command: Command<string>,
	files: string[],
	isGlob: boolean,
): string {
	if (Array.isArray(command) && typeof command[1] === "function") {
		// Command is a tuple: [script, formatArguments]
		const [script, formatArguments] = command as [string, ArgsFn];
		return formatArguments(files, script);
	}

	const script = String(command);
	// For glob-based hooks, append file paths by default.
	// For other hooks, only do so if they explicitly use a function.
	if (isGlob && files.length > 0) {
		return `${script} ${files.join(" ")}`;
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
export function resolveScriptsToRun(
	hookConfig: HookConfig,
	stagedFiles: string[] | null,
): string[] {
	const scriptsToRun = new Set<string>();
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

	if (isGlob) {
		if (stagedFiles && stagedFiles.length > 0) {
			for (const [globPattern, script] of Object.entries(hookConfig)) {
				const matchingFiles = micromatch(stagedFiles, globPattern, {
					matchBase: true,
				});

				if (matchingFiles.length > 0) {
					const commandsToProcess = getCommands(script);
					processListOfCommands(commandsToProcess, matchingFiles);
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
		scriptsToRun.add(
			processCommand(batch.command, Array.from(batch.files), isGlob),
		);
	}

	return Array.from(scriptsToRun);
}

/**
 * Executes a single npm script using `spawn`.
 * @param script The name of the npm script to run.
 */
function executeScript(script: string): Promise<void> {
	return new Promise((resolve, reject) => {
		console.log(`> Running script: ${script}`);
		// The entire script string (command + args) is passed to `npm run`.
		// `shell: true` allows the shell to parse the command and its arguments.
		const child = spawn("npm", ["run", script], {
			stdio: "inherit",
			shell: true,
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				// Reject the promise if the script fails
				reject(new Error(`Script "${script}" exited with code ${code}`));
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
		console.error("Error: ts-git-hooks configuration file not found.");
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

	const finalScripts = resolveScriptsToRun(hookConfig, stagedFiles);

	if (finalScripts.length === 0) {
		console.log(`ts-git-hooks: No scripts to run for ${hookName}.`);
		return true;
	}

	let stashCreated = false;

	try {
		// 1. Stash unstaged changes if they exist
		if (await hasUnstagedChanges()) {
			console.log("ts-git-hooks: Stashing unstaged changes...");
			stashCreated = await stashPushKeepIndex();
		}

		// 2. Run the scripts
		console.log(`ts-git-hooks: Running scripts for ${hookName}...`);
		// Use Promise.all to ensure that if any script fails, the entire hook fails.
		await Promise.all(finalScripts.map((script) => executeScript(script)));

		// 3. For pre-commit, stage any changes made by the scripts
		if (hookName === "pre-commit") {
			const changedFiles = await getChangedFiles();
			if (changedFiles.length > 0) {
				console.log("ts-git-hooks: Adding modified files to the index...");
				await addFiles(changedFiles);
			}
		}

		console.log(`\nts-git-hooks: ${hookName} hook passed.`);
		return true;
	} catch (error: unknown) {
		console.error(
			`\nts-git-hooks: An error occurred during the ${hookName} hook.`,
		);
		if (error instanceof Error && error.message) {
			// Don't log the full error object, just the message for cleaner output.
			console.error(error.message);
		}
		return false;
	} finally {
		// 4. Pop the stash if one was created
		if (stashCreated) {
			try {
				console.log("ts-git-hooks: Restoring unstaged changes...");
				await stashPop();
			} catch (_stashError) {
				console.error(
					`\nCRITICAL: Failed to restore unstaged changes. Please resolve conflicts manually.`,
				);
				// This is a critical failure, we need to inform the user and exit
				process.exit(1);
			}
		}
	}
}
