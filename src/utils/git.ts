import { exec } from "node:child_process";

/**
 * Promisified version of `exec` for running git commands.
 */
function execGit(command: string): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				// stderr is often used for progress indicators by git, so we only log it for actual errors.
				console.error(`Error executing: ${command}\n${stderr}`);
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

/**
 * Retrieves the list of staged files from git.
 * @returns A promise that resolves to an array of staged file paths.
 */
export async function getStagedFiles(): Promise<string[]> {
	const stdout = await execGit("git diff --cached --name-only");
	return stdout.split("\n").filter(Boolean);
}

/**
 * Checks if there are any unstaged changes (including untracked files).
 * @returns A promise that resolves to true if there are unstaged changes, false otherwise.
 */
export async function hasUnstagedChanges(): Promise<boolean> {
	const stdout = await execGit("git status --porcelain -z");
	const parts = stdout.split("\0");

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part) continue;

		const prefix = part.slice(0, 2);
		// X = status of index, Y = status of work tree
		// ?? = untracked
		// _M = modified in work tree
		// _D = deleted in work tree
		// We care about any change in the work tree (Y column) or untracked files.
		if (prefix === "??" || (prefix[1] !== " " && prefix[1] !== undefined)) {
			return true;
		}

		// Renames (R) and Copies (C) in porcelain -z format are followed by the old path
		if (prefix.startsWith("R") || prefix.startsWith("C")) {
			i++;
		}
	}

	return false;
}

/**
 * Stashes unstaged changes, including untracked files, but keeps the index.
 * It also checks if a stash was actually created.
 * @returns A promise that resolves to true if a stash was created, false otherwise.
 */
export async function stashPushKeepIndex(): Promise<boolean> {
	const stdout = await execGit(
		"git stash push --keep-index --include-untracked",
	);
	return !stdout.includes("No local changes to save");
}

/**
 * Pops the latest stash from the stash stack.
 * Throws an error if the stash pop fails (e.g., due to conflicts).
 */
export async function stashPop(): Promise<void> {
	try {
		await execGit("git stash pop");
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
export async function getChangedFiles(): Promise<string[]> {
	const stdout = await execGit("git status --porcelain -z");
	if (!stdout) {
		return [];
	}

	const files: string[] = [];
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
			files.push(path);
		}

		// Renames (R) and Copies (C) in porcelain -z format are followed by the old path
		if (prefix.startsWith("R") || prefix.startsWith("C")) {
			i++;
		}
	}

	return files;
}

/**
 * Stages the specified files.
 * @param files An array of file paths to stage.
 */
export async function addFiles(files: string[]): Promise<void> {
	if (files.length === 0) {
		return;
	}
	const fileList = files.map((file) => `"${file}"`).join(" ");
	await execGit(`git add ${fileList}`);
}
