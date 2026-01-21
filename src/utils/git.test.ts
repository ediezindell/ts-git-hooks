import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getChangedFiles, getStagedFiles, hasUnstagedChanges } from "./git";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// Helper to mock spawn process
function mockSpawn(
	stdoutData: string,
	exitCode = 0,
	stderrData = "",
) {
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

describe("getChangedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should exclude files staged for deletion (D )", async () => {
		mockSpawn("D  deleted-staged.txt\0M  modified.txt\0");

		const files = await getChangedFiles();
		expect(files).toEqual(["modified.txt"]);
        expect(spawn).toHaveBeenCalledWith("git", ["status", "--porcelain", "-z"]);
	});

	it("should exclude files deleted in work tree ( D)", async () => {
		mockSpawn(" D deleted-unstaged.txt\0M  modified.txt\0");
		const files = await getChangedFiles();
		expect(files).toEqual(["modified.txt"]);
	});

	it("should include untracked files (??)", async () => {
		mockSpawn("?? untracked.txt\0");
		const files = await getChangedFiles();
		expect(files).toEqual(["untracked.txt"]);
	});

	it("should handle renamed files (R )", async () => {
		mockSpawn("R  new.txt\0old.txt\0");
		const files = await getChangedFiles();
		expect(files).toEqual(["new.txt"]);
	});
});

describe("hasUnstagedChanges", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return true if there are modified files ( M)", async () => {
		mockSpawn(" M modified.txt\0");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
        expect(spawn).toHaveBeenCalledWith("git", ["status", "--porcelain", "-z"]);
	});

	it("should return true if there are untracked files (??)", async () => {
		mockSpawn("?? untracked.txt\0");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
	});

	it("should return false if there are only staged changes (M )", async () => {
		mockSpawn("M  staged.txt\0");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
	});

	it("should return false if there are no changes", async () => {
		mockSpawn("");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
	});

	it("should return true for RM (renamed and modified)", async () => {
		mockSpawn("RM new.txt\0old.txt\0");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
	});

	it("should return false for R  (staged rename only)", async () => {
		mockSpawn("R  new.txt\0old.txt\0");
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
	});
});

describe("getStagedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return a list of staged files", async () => {
		mockSpawn("file1.ts\nfile2.ts\n");
		const files = await getStagedFiles();
		expect(files).toEqual(["file1.ts", "file2.ts"]);
        expect(spawn).toHaveBeenCalledWith("git", ["diff", "--cached", "--name-only"]);
	});

	it("should return an empty array if no files are staged", async () => {
		mockSpawn("");
		const files = await getStagedFiles();
		expect(files).toEqual([]);
	});
});
