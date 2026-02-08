import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { logger } from "./logger";
import { parseNullSeparatedBuffer } from "./string";

/**
 * Promisified version of `spawn` for running git commands and getting the exit code.
 * Uses `stdio: "ignore"` for maximum performance when output is not needed.
 */
function execGitStatus(args: string[]): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn("git", args, { stdio: "ignore" });

		child.on("close", (code) => {
			resolve(code ?? 1);
		});

		child.on("error", () => {
			resolve(1);
		});
	});
}

/**
 * Promisified version of `spawn` for running git commands.
 * Uses `spawn` directly to avoid shell overhead and argument parsing issues.
 * Returns the raw Buffer output for memory efficiency.
 */
function execGitBuffer(args: string[]): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on("data", (data) => {
			stdoutChunks.push(data);
		});

		child.stderr.on("data", (data) => {
			stderrChunks.push(data);
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve(Buffer.concat(stdoutChunks));
			} else {
				const stdout = Buffer.concat(stdoutChunks).toString("utf8");
				const stderr = Buffer.concat(stderrChunks).toString("utf8");
				// stderr is often used for progress indicators by git, so we only log it for actual errors.
				const errorMessage = `Error executing: git ${args.join(" ")}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
				logger.error(errorMessage);
				reject(new Error(`Git command failed with exit code ${code}`));
			}
		});

		child.on("error", (error) => {
			reject(error);
		});
	});
}

/**
 * Promisified version of `spawn` for running git commands.
 * Returns the output as a UTF-8 string.
 */
async function execGit(args: string[]): Promise<string> {
	const buf = await execGitBuffer(args);
	return buf.toString("utf8");
}

/**
 * Retrieves the list of staged files from git.
 * @returns A promise that resolves to an array of staged file paths.
 */
export async function getStagedFiles(): Promise<string[]> {
	// Use --diff-filter=ACMR to exclude deleted files (D).
	// Use -z to avoid quoting filenames and handle special characters correctly.
	const buf = await execGitBuffer([
		"diff",
		"--cached",
		"--name-only",
		"--diff-filter=ACMR",
		"-z",
	]);
	return parseNullSeparatedBuffer(buf);
}

/**
 * Stashes unstaged changes in tracked files but keeps the index.
 * It also checks if a stash was actually created.
 * @returns A promise that resolves to true if a stash was created, false otherwise.
 */
export async function stashPushKeepIndex(): Promise<boolean> {
	// Hybrid Stashing: We ONLY stash tracked changes.
	// Untracked files are handled separately by physical evacuation.
	const stdout = await execGit(["stash", "push", "--keep-index"]);
	// Git outputs "No local changes to save" when no stash is created
	const noChangesMessage = "No local changes to save";
	return !stdout.includes(noChangesMessage);
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

	const buf = await execGitBuffer(args);
	return parseNullSeparatedBuffer(buf);
}

/**
 * Stages the specified files.
 * @param files An array of file paths to stage.
 * @param force Whether to use the -f option to force add files.
 */
export async function addFiles(files: string[], force = false): Promise<void> {
	if (files.length === 0) {
		return;
	}
	// Pass files directly as arguments to git add.
	// This avoids shell quoting issues and command length limits are handled better by spawn.
	const args = ["add"];
	if (force) {
		args.push("-f");
	}
	args.push(...files);
	await execGit(args);
}

/**
 * Physically moves files and directories to a target backup directory.
 * @param items List of files or directories to move.
 * @param backupDir Target directory.
 */
export async function evacuateFiles(
	items: string[],
	backupDir: string,
): Promise<void> {
	if (items.length === 0) return;

	// Optimization: Pre-calculate unique parent directories to create them in parallel.
	const parentDirs = new Set<string>();
	const moves: { src: string; dest: string }[] = [];

	for (const item of items) {
		// Strip trailing slash if any (git ls-files --directory adds it)
		const normalizedItem = item.replace(/\/$/, "");
		const dest = join(backupDir, normalizedItem);
		const parentDir = dirname(dest);

		parentDirs.add(parentDir);
		moves.push({ src: normalizedItem, dest });
	}

	// 1. Create all parent directories in parallel
	await Promise.all(
		Array.from(parentDirs).map((dir) => mkdir(dir, { recursive: true })),
	);

	// 2. Move all files in parallel
	await Promise.all(moves.map(({ src, dest }) => rename(src, dest)));
}

/**
 * Restores files and directories from a backup directory back to the working directory.
 * This uses a recursive merge-move strategy to handle existing directories.
 * @param backupDir Source backup directory.
 */
export async function restoreFiles(backupDir: string): Promise<void> {
	// Optimization: Cache mkdir promises to avoid race conditions and redundant calls during parallel execution.
	const mkdirCache = new Map<string, Promise<string | undefined>>();
	const ensureDir = (dir: string) => {
		if (dir === ".") return Promise.resolve();
		if (!mkdirCache.has(dir)) {
			mkdirCache.set(dir, mkdir(dir, { recursive: true }));
		}
		return mkdirCache.get(dir) as Promise<string | undefined>;
	};

	const walk = async (currentDir: string) => {
		const entries = await readdir(currentDir, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				const src = join(currentDir, entry.name);
				const relativePath = relative(backupDir, src);
				const dest = relativePath; // Relative to current working directory

				const destStat = await stat(dest).catch(() => null);

				if (entry.isDirectory()) {
					if (destStat?.isDirectory()) {
						// Both are directories: merge them
						await walk(src);
					} else if (destStat) {
						// Destination exists but is not a directory
						throw new Error(
							`Conflict: Cannot restore directory to "${dest}" because a file already exists.`,
						);
					} else {
						// Destination does not exist: move the whole directory
						const parentDir = dirname(dest);
						await ensureDir(parentDir);
						await rename(src, dest);
					}
				} else {
					// It's a file
					if (destStat?.isDirectory()) {
						throw new Error(
							`Conflict: Cannot restore file to "${dest}" because a directory already exists.`,
						);
					}
					// Move the file, potentially overwriting if it was a file (not recommended, but better than dropping)
					const parentDir = dirname(dest);
					await ensureDir(parentDir);
					await rename(src, dest);
				}
			}),
		);
	};

	// Start restoration
	await walk(backupDir);

	// Only clean up if we successfully moved EVERYTHING
	await rm(backupDir, { recursive: true, force: true });
}

/**
 * Lists untracked files and directories.
 * @returns A promise that resolves to an array of untracked paths.
 */
export async function getUntrackedFiles(): Promise<string[]> {
	// -o: other (untracked), --exclude-standard: use standard ignore rules
	// --directory: show directories as a whole if they are untracked
	const buf = await execGitBuffer([
		"ls-files",
		"--others",
		"--exclude-standard",
		"--directory",
		"-z",
	]);
	return parseNullSeparatedBuffer(buf);
}

/**
 * Checks if there are any unstaged changes in tracked files.
 * Uses `git diff --quiet` which is faster as it exits early on the first difference.
 * @returns A promise that resolves to true if there are unstaged changes.
 */
export async function hasUnstagedChanges(): Promise<boolean> {
	// git diff --quiet returns 1 if there are changes, 0 if not.
	const code = await execGitStatus(["diff", "--quiet"]);
	return code !== 0;
}

/**
 * Retrieves comprehensive git status in a single command.
 * Returns staged files, untracked items, and whether unstaged changes exist.
 * This is an optimization to avoid multiple process spawns.
 */
export async function getGitStatus(): Promise<{
	stagedFiles: string[];
	untrackedItems: string[];
	unstagedChangesExist: boolean;
}> {
	// -z: null-terminated output
	// --porcelain=v1: stable output format
	const buf = await execGitBuffer(["status", "--porcelain=v1", "-z"]);

	const stagedFiles: string[] = [];
	const untrackedItems: string[] = [];
	let unstagedChangesExist = false;

	let start = 0;
	while (start < buf.length) {
		const end = buf.indexOf(0, start);
		if (end === -1) break;

		// Status code is at start, start+1. Space at start+2. Path starts at start+3.
		// XY PATH\0
		const x = buf[start]; // ASCII byte
		const y = buf[start + 1]; // ASCII byte
		const pathStart = start + 3;

		// 63 is '?'
		// 1. Untracked (??)
		if (x === 63 && y === 63) {
			untrackedItems.push(buf.toString("utf8", pathStart, end));
		} else {
			// 2. Staged (A=65, M=77, R=82, C=67)
			if (x === 65 || x === 77 || x === 82 || x === 67) {
				stagedFiles.push(buf.toString("utf8", pathStart, end));
			}

			// 3. Unstaged changes (Modified, Deleted, Type changed, or Unmerged in work tree)
			// Any non-space (32) value in Y (except for untracked ??) means worktree differs from index.
			// We already handled ?? case above.
			if (y !== 32) {
				unstagedChangesExist = true;
			}
		}

		// Handle Rename (R=82) / Copy (C=67) second path
		// The next null-terminated string is the old path. We just skip it.
		if (x === 82 || x === 67) {
			const nextEnd = buf.indexOf(0, end + 1);
			if (nextEnd !== -1) {
				start = nextEnd + 1;
				continue;
			}
		}

		start = end + 1;
	}

	return { stagedFiles, untrackedItems, unstagedChangesExist };
}
