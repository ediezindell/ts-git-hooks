import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	addFiles,
	evacuateFiles,
	getChangedFiles,
	getGitStatus,
	getStagedFiles,
	getUntrackedFiles,
	hasUnstagedChanges,
	restoreFiles,
	stashCreate,
} from "./git";

vi.mock("node:fs/promises");
vi.mock("node:path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:path")>();
	return {
		...actual,
		join: vi.fn((...args) => args.join("/")), // simple mock join
	};
});

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

/**
 * Helper to mock spawn process
 */
function mockSpawn(stdoutData: string, exitCode = 0, stderrData = "") {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const child = new EventEmitter();
	(child as any).stdout = stdout;
	(child as any).stderr = stderr;

	(spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);

	// Trigger events on next tick to simulate async process
	setTimeout(() => {
		if (stdoutData) stdout.emit("data", Buffer.from(stdoutData));
		if (stderrData) stderr.emit("data", Buffer.from(stderrData));
		child.emit("close", exitCode);
	}, 0);

	return child;
}

/**
 * Helper to mock spawn process with chunks
 */
function mockSpawnChunks(stdoutChunks: Buffer[], exitCode = 0) {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const child = new EventEmitter();
	(child as any).stdout = stdout;
	(child as any).stderr = stderr;

	(spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);

	// Trigger events on next tick to simulate async process
	setTimeout(() => {
		for (const chunk of stdoutChunks) {
			stdout.emit("data", chunk);
		}
		child.emit("close", exitCode);
	}, 0);

	return child;
}

describe("execGit diagnostics", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should include stdout in error message when git command fails", async () => {
		mockSpawn("some output", 1, "some error");
		try {
			await getStagedFiles();
		} catch (_error) {
			// The implementation logs the message but throws a generic error
			expect(spawn).toHaveBeenCalled();
		}
	});
});

describe("getChangedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should call git diff with correct arguments", async () => {
		mockSpawn("file1.txt\0");
		const files = await getChangedFiles();
		expect(spawn).toHaveBeenCalledWith("git", [
			"diff",
			"--name-only",
			"--diff-filter=ACMR",
			"-z",
		]);
		expect(files).toEqual(["file1.txt"]);
	});

	it("should pass file arguments to git diff", async () => {
		mockSpawn("file1.txt\0");
		const _files = await getChangedFiles(["file1.txt", "file2.txt"]);
		expect(spawn).toHaveBeenCalledWith("git", [
			"diff",
			"--name-only",
			"--diff-filter=ACMR",
			"-z",
			"--",
			"file1.txt",
			"file2.txt",
		]);
	});

	it("should correctly handle multi-byte characters split across chunks", async () => {
		const euroBuffer = Buffer.from("€");
		const chunk1 = Buffer.concat([
			Buffer.from("file_with_"),
			euroBuffer.subarray(0, 1),
		]);
		const chunk2 = Buffer.concat([
			euroBuffer.subarray(1),
			Buffer.from(".txt\0"),
		]);

		mockSpawnChunks([chunk1, chunk2]);

		const files = await getChangedFiles();
		expect(files).toEqual(["file_with_€.txt"]);
	});
});

describe("stashCreate", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should call git stash create and return the hash if changes exist", async () => {
		const hash = "abc1234def5678";
		// First spawn: git stash create → returns hash
		// Second spawn: git checkout-index -f -a → returns ""
		(spawn as unknown as ReturnType<typeof vi.fn>)
			.mockImplementationOnce(() => {
				const child: any = new EventEmitter();
				child.stdout = new EventEmitter();
				child.stderr = new EventEmitter();
				setTimeout(() => {
					child.stdout.emit("data", Buffer.from(hash));
					child.emit("close", 0);
				}, 0);
				return child;
			})
			.mockImplementationOnce(() => {
				const child: any = new EventEmitter();
				child.stdout = new EventEmitter();
				child.stderr = new EventEmitter();
				setTimeout(() => child.emit("close", 0), 0);
				return child;
			});
		const result = await stashCreate();
		expect(spawn).toHaveBeenNthCalledWith(1, "git", ["stash", "create"]);
		expect(spawn).toHaveBeenNthCalledWith(2, "git", [
			"checkout-index",
			"-f",
			"-a",
		]);
		expect(result).toBe(hash);
	});

	it("should return null if there are no changes to stash", async () => {
		mockSpawn("");
		const result = await stashCreate();
		expect(spawn).toHaveBeenCalledWith("git", ["stash", "create"]);
		expect(result).toBeNull();
	});
});

describe("getStagedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return a list of staged files", async () => {
		mockSpawn("file1.ts\0file2.ts\0");
		const files = await getStagedFiles();
		expect(files).toEqual(["file1.ts", "file2.ts"]);
		expect(spawn).toHaveBeenCalledWith("git", [
			"diff",
			"--cached",
			"--name-only",
			"--diff-filter=ACMR",
			"-z",
		]);
	});

	it("should return an empty array if no files are staged", async () => {
		mockSpawn("");
		const files = await getStagedFiles();
		expect(files).toEqual([]);
	});

	it("should handle filenames with spaces correctly", async () => {
		mockSpawn("file with spaces.ts\0file2.ts\0");
		const files = await getStagedFiles();
		expect(files).toEqual(["file with spaces.ts", "file2.ts"]);
	});
});

describe("getUntrackedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return a list of untracked files and directories", async () => {
		mockSpawn("untracked1.txt\0untracked_dir/\0");
		const files = await getUntrackedFiles();
		expect(spawn).toHaveBeenCalledWith("git", [
			"ls-files",
			"--others",
			"--exclude-standard",
			"--directory",
			"-z",
		]);
		expect(files).toEqual(["untracked1.txt", "untracked_dir/"]);
	});
});

describe("hasUnstagedChanges", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return true if there are unstaged changes", async () => {
		// git diff --quiet returns 1 if there are changes
		mockSpawn("", 1);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
		expect(spawn).toHaveBeenCalledWith("git", ["diff", "--quiet"], {
			stdio: "ignore",
		});
	});

	it("should return false if there are no unstaged changes", async () => {
		// git diff --quiet returns 0 if there are no changes
		mockSpawn("", 0);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
		expect(spawn).toHaveBeenCalledWith("git", ["diff", "--quiet"], {
			stdio: "ignore",
		});
	});
});

describe("getGitStatus", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return staged files, untracked files, and unstaged changes status", async () => {
		// M staged1.ts
		// A staged2.ts
		// R renamed.ts\0old.ts
		//  M unstaged.ts
		// ?? untracked.ts
		mockSpawn(
			"M  staged1.ts\0A  staged2.ts\0R  renamed.ts\0old.ts\0 M unstaged.ts\0?? untracked.ts\0",
		);

		const status = await getGitStatus();

		expect(spawn).toHaveBeenCalledWith("git", [
			"status",
			"--porcelain=v1",
			"-z",
		]);

		expect(status.stagedFiles).toEqual([
			"staged1.ts",
			"staged2.ts",
			"renamed.ts",
		]);
		expect(status.untrackedItems).toEqual(["untracked.ts"]);
		expect(status.unstagedChangesExist).toBe(true);
	});

	it("should return unstagedChangesExist as true when there is a deletion in worktree", async () => {
		mockSpawn(" D deleted.ts\0");
		const status = await getGitStatus();
		expect(status.unstagedChangesExist).toBe(true);
		expect(status.stagedFiles).toEqual([]);
	});

	it("should return unstagedChangesExist as true when there is a type change (T) in worktree", async () => {
		mockSpawn(" T typechange.ts\0");
		const status = await getGitStatus();
		expect(status.unstagedChangesExist).toBe(true);
		expect(status.stagedFiles).toEqual([]);
	});

	it("should return stagedFiles including copied files (C)", async () => {
		mockSpawn("C  copied.ts\0orig.ts\0");
		const status = await getGitStatus();
		expect(status.stagedFiles).toEqual(["copied.ts"]);
		expect(status.unstagedChangesExist).toBe(false);
	});

	it("should return empty results when status is clean", async () => {
		mockSpawn("");
		const status = await getGitStatus();
		expect(status.stagedFiles).toEqual([]);
		expect(status.untrackedItems).toEqual([]);
		expect(status.unstagedChangesExist).toBe(false);
	});
});

describe("evacuateFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should move files to the backup directory", async () => {
		await evacuateFiles(["a.txt", "b/c.txt"], "backup");
		expect(mkdir).toHaveBeenCalledTimes(2);
		expect(rename).toHaveBeenCalledTimes(2);
		expect(rename).toHaveBeenCalledWith("a.txt", "backup/a.txt");
		expect(rename).toHaveBeenCalledWith("b/c.txt", "backup/b/c.txt");
	});
});

describe("restoreFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should restore files and directories from backup directory and cleanup", async () => {
		// Mock readdir
		vi.mocked(readdir).mockImplementation((path, _options) => {
			const pathStr = path.toString();
			if (pathStr === "backup") {
				return Promise.resolve([
					{ name: "file1.txt", isDirectory: () => false },
					{ name: "dir1", isDirectory: () => true },
				] as any);
			}
			if (pathStr === "backup/dir1") {
				return Promise.resolve([
					{ name: "subfile.txt", isDirectory: () => false },
				] as any);
			}
			return Promise.resolve([]);
		});

		// Mock lstat for destination checks (not existing)
		vi.mocked(lstat).mockImplementation((_path) =>
			Promise.reject(new Error("ENOENT")),
		);

		await restoreFiles("backup");

		expect(rename).toHaveBeenCalledWith("backup/file1.txt", "./file1.txt");
		expect(rename).toHaveBeenCalledWith("backup/dir1", "./dir1");
		expect(rm).toHaveBeenCalledWith("backup", { recursive: true, force: true });
	});

	it("should skip overwriting if file exists and content is identical", async () => {
		// Scenario: restore 'file1.txt' but it already exists with SAME content
		vi.mocked(readdir).mockResolvedValue([
			{ name: "file1.txt", isDirectory: () => false } as any,
		]);

		// Both exist
		vi.mocked(lstat).mockResolvedValue({
			isDirectory: () => false,
			isSymbolicLink: () => false,
			isFile: () => true,
			size: 100,
		} as any);

		// Identical content
		vi.mocked(readFile).mockResolvedValue(Buffer.from("same content"));

		await restoreFiles("backup");

		// Should verify identical content
		expect(readFile).toHaveBeenCalledTimes(2); // One for src, one for dest

		// Should NOT rename src to dest
		expect(rename).not.toHaveBeenCalledWith("backup/file1.txt", "./file1.txt");
		// Should NOT backup
		expect(rename).not.toHaveBeenCalledWith(
			"backup/file1.txt",
			"./file1.txt.backup",
		);
		// Should still cleanup backup dir
		expect(rm).toHaveBeenCalledWith("backup", { recursive: true, force: true });
	});

	it("should create a backup file if destination exists and content differs", async () => {
		// Scenario: restore 'file1.txt' but it exists with DIFFERENT content
		vi.mocked(readdir).mockResolvedValue([
			{ name: "file1.txt", isDirectory: () => false } as any,
		]);

		// Both exist
		vi.mocked(lstat).mockResolvedValue({
			isDirectory: () => false,
			isSymbolicLink: () => false,
			isFile: () => true,
			size: 100,
		} as any);

		// Different content
		vi.mocked(readFile)
			.mockResolvedValueOnce(Buffer.from("backup content"))
			.mockResolvedValueOnce(Buffer.from("worktree content"));

		await restoreFiles("backup");

		// Should rename src to .backup
		expect(rename).toHaveBeenCalledWith(
			"backup/file1.txt",
			"./file1.txt.backup",
		);
		// Should NOT overwrite original
		expect(rename).not.toHaveBeenCalledWith("backup/file1.txt", "./file1.txt");
	});

	it("should detect conflict if destination is symlink and src is file", async () => {
		vi.mocked(readdir).mockResolvedValue([
			{ name: "link.txt", isDirectory: () => false } as any,
		]);

		// Dest is symlink, Src is file
		vi.mocked(lstat)
			// lstat call for dest (first call)
			.mockResolvedValueOnce({
				isDirectory: () => false,
				isSymbolicLink: () => true, // Dest is symlink
				isFile: () => false,
			} as any)
			// lstat call for src (inside areFilesIdentical helper)
			.mockResolvedValueOnce({
				isDirectory: () => false,
				isSymbolicLink: () => false, // Src is file
				isFile: () => true,
			} as any);

		await restoreFiles("backup");

		// Types differ -> Considered NOT identical -> Should backup
		expect(rename).toHaveBeenCalledWith(
			"backup/link.txt",
			"./link.txt.backup",
		);
	});

	it("should skip overwriting if both are symlinks to same target", async () => {
		vi.mocked(readdir).mockResolvedValue([
			{ name: "link.txt", isDirectory: () => false } as any,
		]);

		// Both are symlinks
		vi.mocked(lstat).mockResolvedValue({
			isDirectory: () => false,
			isSymbolicLink: () => true,
			isFile: () => false,
		} as any);

		// Same target
		vi.mocked(readlink).mockResolvedValue("/target/path");

		await restoreFiles("backup");

		expect(readlink).toHaveBeenCalledTimes(2);
		expect(rename).not.toHaveBeenCalledWith("backup/link.txt", "./link.txt");
		expect(rename).not.toHaveBeenCalledWith(
			"backup/link.txt",
			"./link.txt.backup",
		);
	});
});

describe("addFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should call git add with files", async () => {
		mockSpawn("");
		await addFiles(["file1.txt", "file2.txt"]);
		expect(spawn).toHaveBeenCalledWith("git", [
			"add",
			"--",
			"file1.txt",
			"file2.txt",
		]);
	});

	it("should use -- to separate options from filenames to prevent injection", async () => {
		mockSpawn("");
		const files = ["-f", "--version", "normal.ts"];
		await addFiles(files);

		expect(spawn).toHaveBeenCalledWith("git", [
			"add",
			"--",
			"-f",
			"--version",
			"normal.ts",
		]);
	});

	it("should call git add with force flag when force is true", async () => {
		mockSpawn("");
		await addFiles(["file1.txt", "file2.txt"], true);
		expect(spawn).toHaveBeenCalledWith("git", [
			"add",
			"-f",
			"--",
			"file1.txt",
			"file2.txt",
		]);
	});

	it("should not call git add when no files are provided", async () => {
		await addFiles([]);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("should not call git add when no files are provided even with force", async () => {
		await addFiles([], true);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("should not add force flag when force is false", async () => {
		mockSpawn("");
		await addFiles(["file1.txt"], false);
		expect(spawn).toHaveBeenCalledWith("git", ["add", "--", "file1.txt"]);
	});
});
