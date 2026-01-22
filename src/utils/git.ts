import { spawn } from "node:child_process";

/**
 * Promisified version of `spawn` for running git commands.
 * Uses `spawn` directly to avoid shell overhead and argument parsing issues.
 */
function execGit(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args);
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				// stderr is often used for progress indicators by git, so we only log it for actual errors.
				console.error(`Error executing: git ${args.join(" ")}\n${stderr}`);
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
	const stdout = await execGit(["diff", "--cached", "--name-only"]);
	return stdout.split("\n").filter(Boolean);
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
		console.error(
			"Error popping stash. This may be due to a conflict. Please resolve it manually.",
		);
		throw error;
	}
}

/**
 * Gets a list of files that have been modified or created in the working directory.
 * @returns A promise that resolves to an array of changed file paths.
 */
export async function getChangedFiles(files?: string[]): Promise<string[]> {
	if (files && files.length === 0) {
		return [];
	}

	const args = ["status", "--porcelain", "-z"];
	if (files) {
		args.push("--", ...files);
	}

	const stdout = await execGit(args);
	if (!stdout) {
		return [];
	}

	const changedFiles: string[] = [];
	const parts = stdout.split("\0");

	for (let i = 0; i < parts.length; i++) {
		const line = parts[i];
		if (!line) continue;

		const prefix = line.slice(0, 2);
		const path = line.slice(3);

		// Matches modified (M), added (A), or untracked (??) files.
		// Exclude deleted files (D)
		const isDeleted = prefix === " D" || prefix === "D ";
		const hasChange = prefix.trim().length > 0;

		if (hasChange && !isDeleted) {
			changedFiles.push(path);
		}

		// Renames (R) and Copies (C) in porcelain -z format are followed by the old path
		if (prefix.startsWith("R") || prefix.startsWith("C")) {
			i++;
		}
	}

	return changedFiles;
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
