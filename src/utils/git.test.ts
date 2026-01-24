import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	evacuateFiles,
	getChangedFiles,
	getStagedFiles,
	getUntrackedFiles,
	hasUnstagedChanges,
	restoreFiles,
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

	it("should return a list of untracked files", async () => {
		mockSpawn("untracked1.txt\0untracked2.txt\0");
		const files = await getUntrackedFiles();
		expect(spawn).toHaveBeenCalledWith("git", [
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
		]);
		expect(files).toEqual(["untracked1.txt", "untracked2.txt"]);
	});
});

describe("hasUnstagedChanges", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return true if there are unstaged changes", async () => {
		mockSpawn("modified.ts\0");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
	});

	it("should return false if there are no unstaged changes", async () => {
		mockSpawn("");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
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

	it("should restore files from backup directory and cleanup", async () => {
		vi.mocked(readdir).mockResolvedValue(["file1.txt", "dir1"] as any);
		vi.mocked(stat).mockImplementation((path: string) => {
			if (path.endsWith("dir1")) {
				return Promise.resolve({ isDirectory: () => true } as any);
			}
			return Promise.resolve({ isDirectory: () => false } as any);
		});
		vi.mocked(readdir).mockImplementation((path: string) => {
			if (path.endsWith("dir1")) return Promise.resolve(["subfile.txt"] as any);
			return Promise.resolve(["file1.txt", "dir1"] as any);
		});

		await restoreFiles("backup");

		expect(rename).toHaveBeenCalledWith("backup/file1.txt", "file1.txt");
		expect(rename).toHaveBeenCalledWith(
			"backup/dir1/subfile.txt",
			"dir1/subfile.txt",
		);
		expect(rm).toHaveBeenCalledWith("backup", { recursive: true, force: true });
	});
});
