import { spawn } from "node:child_process";
import micromatch from "micromatch";
import type { Command, GitHook } from "../types";
import {
	addFiles,
	getChangedFiles,
	getStagedFiles,
	hasUnstagedChanges,
	stashPop,
	stashPushKeepIndex,
} from "../utils/git";
import { loadConfig } from "./config";

/**
 * Executes a single npm script using `spawn`.
 * @param script The name of the npm script to run.
 */
function executeScript(script: string): Promise<void> {
	return new Promise((resolve, reject) => {
		console.log(`> Running script: ${script}`);
		const child = spawn("npm", ["run", script], {
			stdio: "inherit",
			shell: true, // Use shell for better cross-platform compatibility
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
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
export async function runHook(hookName: GitHook): Promise<boolean> {
	const config = await loadConfig();

	if (!config) {
		console.error("Error: ts-git-hooks configuration file not found.");
		return false;
	}

	const hookConfig = config[hookName];

	if (!hookConfig || Object.keys(hookConfig).length === 0) {
		return true; // No configuration for this hook, so it's a success
	}

	const scriptsToRun = new Set<string>();
	const { run, ...globConfigs } = hookConfig;
	const stagedFiles = await getStagedFiles();

	// Handle unconditional scripts from 'run'
	if (run) {
		const isCommandTuple = Array.isArray(run) && typeof run[1] === "function";
		const commands: Command<string>[] = isCommandTuple
			? [run as Command<string>]
			: Array.isArray(run)
				? (run as Command<string>[])
				: [run as Command<string>];

		for (const command of commands) {
			// A command is a tuple if it's an array and its second element is a function.
			if (Array.isArray(command) && typeof command[1] === "function") {
				const [, argsFn] = command;
				scriptsToRun.add(argsFn(stagedFiles ?? []));
			} else {
				// It's a string. For `run`, we pass staged files as the default.
				scriptsToRun.add(
					stagedFiles && stagedFiles.length > 0
						? `${command} ${stagedFiles.join(" ")}`
						: String(command),
				);
			}
		}
	}

	// Handle glob-based scripts
	if (stagedFiles && stagedFiles.length > 0) {
		for (const [globPattern, scriptOrScripts] of Object.entries(globConfigs)) {
			const matchingFiles = micromatch(stagedFiles, globPattern, {
				matchBase: true, // Allows patterns like *.js to match files in subdirectories
			});

			if (matchingFiles.length > 0) {
				const isCommandTuple =
					Array.isArray(scriptOrScripts) &&
					typeof scriptOrScripts[1] === "function";

				const commands: Command<string>[] = isCommandTuple
					? [scriptOrScripts as Command<string>]
					: Array.isArray(scriptOrScripts)
						? (scriptOrScripts as Command<string>[])
						: [scriptOrScripts as Command<string>];

				for (const command of commands) {
					// A command is a tuple if it's an array and its second element is a function.
					if (Array.isArray(command) && typeof command[1] === "function") {
						const [, argsFn] = command;
						scriptsToRun.add(argsFn(matchingFiles));
					} else {
						// It's a string, so append the matching files
						scriptsToRun.add(`${command} ${matchingFiles.join(" ")}`);
					}
				}
			}
		}
	}

	const finalScripts = Array.from(scriptsToRun);

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
		const results = await Promise.allSettled(
			finalScripts.map((script) => executeScript(script)),
		);

		const failedScripts = results.filter(
			(result) => result.status === "rejected",
		);

		if (failedScripts.length > 0) {
			throw new Error(`\n${hookName} hook failed. At least one script failed.`);
		}

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
	} catch (error: any) {
		console.error(
			`\nts-git-hooks: An error occurred during the ${hookName} hook.`,
		);
		if (error?.message) {
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
