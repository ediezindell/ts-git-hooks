import { exec } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getChangedFiles, getStagedFiles, hasUnstagedChanges } from "./git";

vi.mock("node:child_process", () => ({
	exec: vi.fn(),
}));

describe("getChangedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should exclude files staged for deletion (D )", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "D  deleted-staged.txt\0M  modified.txt\0", "");
				}
			},
		);

		const files = await getChangedFiles();
		expect(files).toEqual(["modified.txt"]);
	});

	it("should exclude files deleted in work tree ( D)", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, " D deleted-unstaged.txt\0M  modified.txt\0", "");
				}
			},
		);
		const files = await getChangedFiles();
		expect(files).toEqual(["modified.txt"]);
	});

	it("should include untracked files (??)", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "?? untracked.txt\0", "");
				}
			},
		);
		const files = await getChangedFiles();
		expect(files).toEqual(["untracked.txt"]);
	});

	it("should handle renamed files (R )", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "R  new.txt\0old.txt\0", "");
				}
			},
		);
		const files = await getChangedFiles();
		expect(files).toEqual(["new.txt"]);
	});
});

describe("hasUnstagedChanges", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return true if there are modified files ( M)", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, " M modified.txt\0", "");
				}
			},
		);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
	});

	it("should return true if there are untracked files (??)", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "?? untracked.txt\0", "");
				}
			},
		);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
	});

	it("should return false if there are only staged changes (M )", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "M  staged.txt\0", "");
				}
			},
		);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
	});

	it("should return false if there are no changes", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "", "");
				}
			},
		);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
	});

	it("should return true for RM (renamed and modified)", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "RM new.txt\0old.txt\0", "");
				}
			},
		);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(true);
	});

	it("should return false for R  (staged rename only)", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git status --porcelain -z")) {
					callback(null, "R  new.txt\0old.txt\0", "");
				}
			},
		);
		const hasChanges = await hasUnstagedChanges();
		expect(hasChanges).toBe(false);
	});
});

describe("getStagedFiles", () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should return a list of staged files", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git diff --cached --name-only")) {
					callback(null, "file1.ts\nfile2.ts\n", "");
				}
			},
		);
		const files = await getStagedFiles();
		expect(files).toEqual(["file1.ts", "file2.ts"]);
	});

	it("should return an empty array if no files are staged", async () => {
		(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(cmd, callback) => {
				if (cmd.includes("git diff --cached --name-only")) {
					callback(null, "", "");
				}
			},
		);
		const files = await getStagedFiles();
		expect(files).toEqual([]);
	});
});
