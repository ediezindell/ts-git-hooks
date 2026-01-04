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
			resolve(stdout.trim());
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
	const stdout = await execGit("git status --porcelain");
	// --porcelain returns output for staged, unstaged, and untracked files.
	// We are interested in unstaged (M) and untracked (??).
	return stdout.split("\n").some((line) => {
		const prefix = line.slice(0, 2);
		return prefix === " M" || prefix === "??";
	});
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
	const stdout = await execGit("git status --porcelain");
	if (!stdout) {
		return [];
	}
	return stdout
		.split("\n")
		.filter((line) => {
			// Matches modified (M), added (A), or untracked (??) files.
			const prefix = line.slice(0, 2);
			return (
				prefix.trim().length > 0 &&
				prefix !== " D" && // Exclude deleted files (unstaged)
				prefix !== "D " // Exclude deleted files (staged)
			);
		})
		.map((line) => line.slice(3));
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
