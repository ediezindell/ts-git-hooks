import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getChangedFiles, getStagedFiles } from "./git";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// Helper to mock spawn process
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

// Helper to mock spawn process with chunks
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

	it("should correctly handle multi-byte characters split across chunks", async () => {
		// Euro sign (€) is 3 bytes in UTF-8: E2 82 AC
		// We split it so E2 is in first chunk, 82 AC is in second
		const euroBuffer = Buffer.from("€");
		const chunk1 = Buffer.concat([
			Buffer.from("?? file_with_"),
			euroBuffer.subarray(0, 1),
		]);
		const chunk2 = Buffer.concat([
			euroBuffer.subarray(1),
			Buffer.from(".txt\0"),
		]);

		mockSpawnChunks([chunk1, chunk2]);

		const files = await getChangedFiles();
		// If decoding is broken, it will likely return "file_with_.txt" or similar
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
