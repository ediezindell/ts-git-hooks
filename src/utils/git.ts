import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { logger } from "./logger";
import { parseNullSeparatedList } from "./string";

/**
 * Promisified version of `spawn` for running git commands.
 * Uses `spawn` directly to avoid shell overhead and argument parsing issues.
 */
function execGit(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args);
		const stdoutDecoder = new StringDecoder("utf8");
		const stderrDecoder = new StringDecoder("utf8");
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			// Use StringDecoder to correctly handle multi-byte characters split across chunks
			stdout += stdoutDecoder.write(data);
		});

		child.stderr.on("data", (data) => {
			stderr += stderrDecoder.write(data);
		});

		child.on("close", (code) => {
			// Flush any remaining bytes
			stdout += stdoutDecoder.end();
			stderr += stderrDecoder.end();

			if (code === 0) {
				resolve(stdout);
			} else {
				// stderr is often used for progress indicators by git, so we only log it for actual errors.
				logger.error(`Error executing: git ${args.join(" ")}\n${stderr}`);
				reject(new Error(`Git command failed with exit code ${code}`));
			}
		});

		child.on("error", (error) => {
			reject(error);
		});
	});
}

/**
 * Retrieves the list of staged files from git.
 * @returns A promise that resolves to an array of staged file paths.
 */
export async function getStagedFiles(): Promise<string[]> {
	// Use --diff-filter=ACMR to exclude deleted files (D).
	// Use -z to avoid quoting filenames and handle special characters correctly.
	const stdout = await execGit([
		"diff",
		"--cached",
		"--name-only",
		"--diff-filter=ACMR",
		"-z",
	]);
	return parseNullSeparatedList(stdout);
}

/**
 * Stashes unstaged changes, including untracked files, but keeps the index.
 * It also checks if a stash was actually created.
 * @returns A promise that resolves to true if a stash was created, false otherwise.
 */
export async function stashPushKeepIndex(): Promise<boolean> {
	const stdout = await execGit([
		"stash",
		"push",
		"--keep-index",
		"--include-untracked",
	]);
	return !stdout.includes("No local changes to save");
}

/**
 * Pops the latest stash from the stash stack.
 * Throws an error if the stash pop fails (e.g., due to conflicts).
 */
export async function stashPop(): Promise<void> {
	try {
		await execGit(["stash", "pop"]);
	} catch (error) {
		logger.error(
			"Error popping stash. This may be due to a conflict. Please resolve it manually.",
		);
		throw error;
	}
}

/**
 * Gets a list of files that have been modified in the working directory (excluding untracked files).
 * Uses `git diff` which is faster than `git status` and avoids staging untracked files.
 * @returns A promise that resolves to an array of changed file paths.
 */
export async function getChangedFiles(files?: string[]): Promise<string[]> {
	if (files && files.length === 0) {
		return [];
	}

	const args = ["diff", "--name-only", "--diff-filter=ACMR", "-z"];
	if (files) {
		args.push("--", ...files);
	}

	const stdout = await execGit(args);
	return parseNullSeparatedList(stdout);
}

/**
 * Stages the specified files.
 * @param files An array of file paths to stage.
 */
export async function addFiles(files: string[]): Promise<void> {
	if (files.length === 0) {
		return;
	}
	// Pass files directly as arguments to git add.
	// This avoids shell quoting issues and command length limits are handled better by spawn.
	await execGit(["add", ...files]);
}
