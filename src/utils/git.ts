import { spawn } from "node:child_process";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { logger } from "./logger";
import { parseNullSeparatedBuffer } from "./string";

/**
 * Git status ASCII codes for parsing --porcelain output.
 */
const ASCII = {
	QUESTION: 63, // '?'
	SPACE: 32, // ' '
	A: 65, // 'A'
	M: 77, // 'M'
	R: 82, // 'R'
	C: 67, // 'C'
} as const;

/**
 * Status codes that indicate a file is staged in the index.
 */
const STAGED_CODES = new Set<number>([ASCII.A, ASCII.M, ASCII.R, ASCII.C]);

/**
 * Status codes that indicate a rename or copy operation, followed by a second path.
 */
const RENAMED_OR_COPIED_CODES = new Set<number>([ASCII.R, ASCII.C]);

/**
 * Promisified version of `spawn` for running git commands and getting the exit code.
 * Uses `stdio: "ignore"` for maximum performance when output is not needed.
 */
function execGitStatus(args: string[]): Promise<number> {
	return new Promise((resolve) => {
		spawn("git", args, { stdio: "ignore" })
			.on("close", (code) => resolve(code ?? 1))
			.on("error", () => resolve(1));
	});
}

/**
 * Promisified version of `spawn` for running git commands.
 * Uses `spawn` directly to avoid shell overhead and argument parsing issues.
 * Returns the raw Buffer output for memory efficiency. When `stdin` is supplied
 * it is written to the child process before its stdin is closed, enabling
 * `--pathspec-from-file=-` style invocations that bypass the OS argv length
 * limit (notably the 256KB ceiling on macOS).
 */
function execGitBuffer(
	args: string[],
	stdin?: string | Buffer,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on("data", (data) => stdoutChunks.push(data));
		child.stderr.on("data", (data) => stderrChunks.push(data));

		child.on("close", (code) => {
			if (code === 0) {
				resolve(Buffer.concat(stdoutChunks));
			} else {
				const stdout = Buffer.concat(stdoutChunks).toString("utf8");
				const stderr = Buffer.concat(stderrChunks).toString("utf8");

				// stderr is often used for progress indicators by git, so we only log it for actual errors.
				const errorDetail = `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
				logger.error(`Error executing: git ${args.join(" ")}\n${errorDetail}`);

				reject(new Error(`Git command failed with exit code ${code}`));
			}
		});

		child.on("error", reject);

		if (stdin !== undefined) {
			child.stdin.write(stdin);
			child.stdin.end();
		}
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
 * Promisified version of `spawn` for running git commands.
 * Parses the null-separated output into an array of strings.
 */
async function execGitList(args: string[]): Promise<string[]> {
	const buf = await execGitBuffer(args);
	return parseNullSeparatedBuffer(buf);
}

/**
 * Resolves the absolute path to the git hooks directory via `git rev-parse --git-path hooks`.
 * Honors GIT_DIR and linked worktrees; throws when invoked outside a git repo.
 */
export async function getGitHooksDir(): Promise<string> {
	const out = (await execGit(["rev-parse", "--git-path", "hooks"])).trim();
	return isAbsolute(out) ? out : resolve(process.cwd(), out);
}

/**
 * Retrieves the list of staged files from git.
 * @returns A promise that resolves to an array of staged file paths.
 */
export async function getStagedFiles(): Promise<string[]> {
	// Use --diff-filter=ACMR to exclude deleted files (D).
	// Use -z to avoid quoting filenames and handle special characters correctly.
	return execGitList([
		"diff",
		"--cached",
		"--name-only",
		"--diff-filter=ACMR",
		"-z",
	]);
}

/**
 * Creates a stash object without updating refs/stash, keeping the user's stash history clean.
 * Simulates --keep-index: the index is preserved, and the working tree is restored to match it.
 * Untracked files are handled separately by physical evacuation.
 * @returns The stash commit hash if changes were stashed, or null if there was nothing to stash.
 */
export async function stashCreate(): Promise<string | null> {
	const hash = (await execGit(["stash", "create"])).trim();
	if (!hash) return null;
	// Restore working tree to match the index (removes unstaged tracked changes)
	await execGit(["checkout-index", "-f", "-a"]);
	return hash;
}

/**
 * Applies a stash by its commit hash.
 * Throws an error if the stash apply fails (e.g., due to conflicts).
 * @param hash The stash commit hash to apply.
 */
export async function stashApply(hash: string): Promise<void> {
	await execGit(["stash", "apply", hash]);
}

/**
 * Hard-resets the index and working tree to match the given tree-ish.
 * Does not move HEAD. Untracked files are preserved.
 * Used by the formatter-replay flow to restore the pre-lint working tree state.
 */
export async function resetToTree(treeIsh: string): Promise<void> {
	await execGit(["read-tree", "--reset", "-u", treeIsh]);
}

/**
 * Replaces the index with the given tree-ish, leaving the working tree untouched.
 * Used by the formatter-replay flow to restore the lint result into the index after
 * the working tree has been re-formatted with unstaged changes included.
 */
export async function setIndexFromTree(treeIsh: string): Promise<void> {
	await execGit(["read-tree", "--reset", treeIsh]);
}

/**
 * Saves the current index state as a Git tree object.
 * Call this before stashing to enable full rollback on stash apply failure.
 * @returns The tree object hash representing the current staged state.
 */
export async function saveIndexState(): Promise<string> {
	return (await execGit(["write-tree"])).trim();
}

/**
 * Rolls back the working directory and index to the state before the pre-commit hook ran.
 * Called when stash apply fails (e.g., due to conflicts with formatter changes).
 *
 * After rollback:
 *   - Index contains the original staged changes
 *   - Working tree reflects only the staged changes
 *   - Unstaged changes remain accessible via git stash (promoted to refs/stash if stashHash is provided)
 *
 * @param origIndexTree The tree hash saved before the hook ran (via saveIndexState).
 * @param stashHash If provided, promotes the dangling stash object to refs/stash for user recovery.
 */
export async function rollbackToPreCommitState(
	origIndexTree: string,
	stashHash?: string,
): Promise<void> {
	if (stashHash) {
		// Promote the internal stash object to refs/stash so the user can see it
		// with `git stash list` and recover with `git stash pop`
		await execGit(["update-ref", "refs/stash", stashHash]);
	}
	// Reset index to HEAD, clearing any conflict/merge state from the failed stash apply
	await execGit(["reset", "HEAD"]);
	// Restore working tree from the (now-HEAD) index, clearing any conflict markers
	await execGit(["checkout", "--", "."]);
	// Restore the index to the original staged state
	await execGit(["read-tree", origIndexTree]);
	// Update working tree to reflect the restored staged index
	await execGit(["checkout-index", "-f", "-a"]);
}

/**
 * Gets a list of files that have been modified in the working directory (excluding untracked files).
 * Uses `git diff` which is faster than `git status` and avoids staging untracked files.
 *
 * `git diff` does not accept `--pathspec-from-file`, so when scoping to a
 * caller-supplied list we fetch the unscoped diff and filter in-process. This
 * keeps the OS argv length out of the picture while preserving the same set
 * semantics the path-scoped form would have produced.
 *
 * @returns A promise that resolves to an array of changed file paths.
 */
export async function getChangedFiles(files?: string[]): Promise<string[]> {
	if (files?.length === 0) {
		return [];
	}

	const allChanged = await execGitList([
		"diff",
		"--name-only",
		"--diff-filter=ACMR",
		"-z",
	]);

	if (!files) return allChanged;

	const allowed = new Set(files);
	return allChanged.filter((f) => allowed.has(f));
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
	const args = ["add"];
	if (force) {
		args.push("-f");
	}
	// Pass paths via stdin (NUL-separated) so we never hit the OS argv length
	// limit and avoid pathspec/option ambiguity entirely.
	args.push("--pathspec-from-file=-", "--pathspec-file-nul");
	await execGitBuffer(args, files.join("\0"));
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

	// Optimization: Pre-calculate unique parent directories and destination paths.
	// Cache directory paths to avoid redundant join and dirname calls (~O(N) syscall reduction).
	const parentDirs = new Set<string>();
	const moves: { src: string; dest: string }[] = [];
	const dirCache = new Map<string, string>();

	for (const item of items) {
		// Optimization: Use endsWith instead of regex for faster trailing slash removal.
		const src = item.endsWith("/") ? item.slice(0, -1) : item;
		const itemDir = dirname(src);

		let parentDirInBackup = dirCache.get(itemDir);
		if (parentDirInBackup === undefined) {
			parentDirInBackup = join(backupDir, itemDir);
			dirCache.set(itemDir, parentDirInBackup);
			parentDirs.add(parentDirInBackup);
		}

		moves.push({ src, dest: join(backupDir, src) });
	}

	// 1. Create all parent directories in parallel with restrictive mode so
	//    backed-up contents are not readable by other users on shared systems.
	await Promise.all(
		Array.from(parentDirs).map((dir) =>
			mkdir(dir, { recursive: true, mode: 0o700 }),
		),
	);

	// 2. Refuse to rename onto a pre-existing symlink at dest — an attacker
	//    who can stage a symlink under backupDir could otherwise redirect
	//    evacuated files outside the intended tree.
	await Promise.all(
		moves.map(async ({ dest }) => {
			try {
				const stat = await lstat(dest);
				if (stat.isSymbolicLink()) {
					throw new Error(
						`Refusing to evacuate onto pre-existing symlink at ${dest}`,
					);
				}
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
			}
		}),
	);

	// 3. Move all files in parallel
	await Promise.all(moves.map(({ src, dest }) => rename(src, dest)));
}

/**
 * Helper to check if two files are identical in content.
 */
async function areFilesIdentical(
	pathA: string,
	pathB: string,
): Promise<boolean> {
	try {
		const [statA, statB] = await Promise.all([lstat(pathA), lstat(pathB)]);

		// Compare file types
		if (statA.isSymbolicLink() !== statB.isSymbolicLink()) return false;
		if (statA.isDirectory() !== statB.isDirectory()) return false;
		if (statA.isFile() !== statB.isFile()) return false;

		// If symlinks, compare targets
		if (statA.isSymbolicLink()) {
			const [linkA, linkB] = await Promise.all([
				readlink(pathA),
				readlink(pathB),
			]);
			return linkA === linkB;
		}

		// If directories, we can't easily compare equality (and restoreFiles merges directories anyway).
		// We treat directories as "not identical" to proceed with merge logic, or "identical" to skip?
		// restoreFiles handles directory merging recursively, so this helper is likely called for files.
		if (statA.isDirectory()) return false;

		// Compare sizes
		if (statA.size !== statB.size) return false;

		// Compare content
		const [bufA, bufB] = await Promise.all([readFile(pathA), readFile(pathB)]);
		return bufA.equals(bufB);
	} catch {
		return false;
	}
}

/**
 * Restores files and directories from a backup directory back to the working directory.
 * This uses a recursive merge-move strategy to handle existing directories.
 * Adds safety checks to prevent overwriting modified files in the working directory.
 *
 * @param backupDir Source backup directory.
 * @param targetDir Target directory (defaults to current working directory).
 */
export async function restoreFiles(
	backupDir: string,
	targetDir = ".",
): Promise<void> {
	// Optimization: Cache mkdir promises to avoid race conditions and redundant calls during parallel execution.
	const mkdirCache = new Map<string, Promise<void>>();

	const ensureDir = (dir: string): Promise<void> => {
		if (dir === "." || dir === "") return Promise.resolve();

		const cached = mkdirCache.get(dir);
		if (cached) return cached;

		const promise = (async () => {
			await mkdir(dir, { recursive: true });
		})();

		mkdirCache.set(dir, promise);
		return promise;
	};

	const walk = async (currentDir: string) => {
		const entries = await readdir(currentDir, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				const src = join(currentDir, entry.name);
				const relativePath = relative(backupDir, src);
				const dest = join(targetDir, relativePath);

				// Security: Use lstat instead of stat to avoid following symlinks.
				// This prevents an attacker from creating a symlink to a sensitive directory
				// and having the restore process traverse into it.
				const destStat = await lstat(dest).catch(() => null);

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
						await ensureDir(dirname(dest));
						await rename(src, dest);
					}
				} else {
					// It's a file (or symlink)
					if (destStat?.isDirectory()) {
						throw new Error(
							`Conflict: Cannot restore file to "${dest}" because a directory already exists.`,
						);
					}

					if (destStat) {
						// Destination exists. Check if it's identical to the backup.
						const identical = await areFilesIdentical(src, dest);
						if (identical) {
							// Identical: No need to restore (backup will be deleted).
							// We can just skip.
							return;
						}

						// Conflict: File exists and is different. Probe for a free
						// name so a user-created "*.backup" file is never clobbered
						// (rename overwrites its destination unconditionally).
						let backupDest = `${dest}.backup`;
						for (
							let suffix = 1;
							await lstat(backupDest)
								.then(() => true)
								.catch(() => false);
							suffix++
						) {
							backupDest = `${dest}.backup.${suffix}`;
						}
						logger.warn(
							`Conflict: File "${dest}" already exists and differs from backup.\n` +
								`Restoring backup to "${backupDest}" to avoid overwriting your changes.`,
						);
						await ensureDir(dirname(backupDest));
						await rename(src, backupDest);
						return;
					}

					// Move the file
					await ensureDir(dirname(dest));
					await rename(src, dest);
				}
			}),
		);
	};

	// Start restoration
	await walk(backupDir);

	// Only clean up if we successfully moved EVERYTHING (or handled collisions)
	await rm(backupDir, { recursive: true, force: true });
}

/**
 * Lists untracked files and directories.
 * @returns A promise that resolves to an array of untracked paths.
 */
export async function getUntrackedFiles(): Promise<string[]> {
	// -o: other (untracked), --exclude-standard: use standard ignore rules
	// --directory: show directories as a whole if they are untracked
	return execGitList([
		"ls-files",
		"--others",
		"--exclude-standard",
		"--directory",
		"-z",
	]);
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

		// The porcelain v1 output format is "XY PATH\0" (when using -z)
		// X: Status in the index (staged changes)
		// Y: Status in the working tree (unstaged changes)
		const indexStatus = buf[start];
		const workTreeStatus = buf[start + 1];
		const pathStart = start + 3;

		// 1. Untracked items are denoted by "??" status
		if (indexStatus === ASCII.QUESTION && workTreeStatus === ASCII.QUESTION) {
			untrackedItems.push(buf.toString("utf8", pathStart, end));
		} else {
			// 2. Staged files (A=Added, M=Modified, R=Renamed, C=Copied in the index)
			// Explicitly skip Deleted (D) files in the index.
			if (STAGED_CODES.has(indexStatus)) {
				stagedFiles.push(buf.toString("utf8", pathStart, end));
			}

			// 3. Unstaged changes exist if the working tree status (Y) is not a space.
			// This includes Modified (M), Deleted (D), etc. in the working tree.
			if (workTreeStatus !== ASCII.SPACE) {
				unstagedChangesExist = true;
			}
		}

		// Handle Rename (R) or Copy (C) which include a second path (the original source):
		// "XY DEST_PATH\0ORIG_PATH\0"
		// We MUST skip the original path to avoid it being treated as a new status entry.
		if (RENAMED_OR_COPIED_CODES.has(indexStatus)) {
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
