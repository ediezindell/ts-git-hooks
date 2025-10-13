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
	const stagedFiles = await getStagedFiles();

	// Check if the hook config is for glob-based scripts (an object) or unconditional.
	if (
		typeof hookConfig === "object" &&
		!Array.isArray(hookConfig) &&
		hookConfig !== null
	) {
		// Glob-based execution for file-dependent hooks
		if (stagedFiles && stagedFiles.length > 0) {
			for (const [globPattern, scriptOrScripts] of Object.entries(
				hookConfig,
			)) {
				const matchingFiles = micromatch(stagedFiles, globPattern, {
					matchBase: true,
				});

				if (matchingFiles.length > 0) {
					const commands: Command<string>[] = Array.isArray(scriptOrScripts)
						? (scriptOrScripts as Command<string>[])
						: [scriptOrScripts as Command<string>];

					for (const command of commands) {
						if (Array.isArray(command) && typeof command[1] === "function") {
							const [, argsFn] = command;
							scriptsToRun.add(argsFn(matchingFiles));
						} else {
							scriptsToRun.add(`${command} ${matchingFiles.join(" ")}`);
						}
					}
				}
			}
		}
	} else {
		// Unconditional execution for file-independent hooks
		const commands: Command<string>[] = Array.isArray(hookConfig)
			? (hookConfig as Command<string>[])
			: [hookConfig as Command<string>];

		for (const command of commands) {
			if (Array.isArray(command) && typeof command[1] === "function") {
				const [, argsFn] = command;
				// Pass all staged files to unconditional hooks if needed
				scriptsToRun.add(argsFn(stagedFiles ?? []));
			} else {
				// For simple strings, run them without arguments
				scriptsToRun.add(String(command));
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
	} catch (error: unknown) {
		console.error(
			`\nts-git-hooks: An error occurred during the ${hookName} hook.`,
		);
		if (error instanceof Error) {
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
