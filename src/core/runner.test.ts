import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobHookConfig, TSGitHookConfig } from "../types";
import {
	addFiles,
	evacuateFiles,
	getChangedFiles,
	getGitStatus,
	getStagedFiles,
	getUntrackedFiles,
	hasUnstagedChanges,
	restoreFiles,
	stashPop,
	stashPushKeepIndex,
} from "../utils/git";
import { getPackageManager } from "../utils/packageManager";
import { loadConfig } from "./config";
import { resolveScriptsToRun, runHook } from "./runner";

// Mock dependencies
vi.mock("./config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./config")>();
	return {
		...actual,
		loadConfig: vi.fn(),
	};
});
vi.mock("../utils/git");
vi.mock("../utils/packageManager");
vi.mock("node:child_process");

// A mock ChildProcess to control its events
class MockChildProcess extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill = vi.fn();
}

const simulateSuccess = (process: MockChildProcess) => {
	setTimeout(() => process.emit("close", 0), 0);
};

const simulateFailure = (process: MockChildProcess) => {
	setTimeout(() => process.emit("close", 1), 0);
};

// Common setup for all test suites
const setupDefaultMocks = () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});

	vi.mocked(getStagedFiles).mockResolvedValue([]);
	vi.mocked(getGitStatus).mockResolvedValue({
		stagedFiles: [],
		untrackedItems: [],
		unstagedChangesExist: false,
	});
	vi.mocked(stashPushKeepIndex).mockResolvedValue(false);
	vi.mocked(stashPop).mockResolvedValue(undefined);
	vi.mocked(getChangedFiles).mockResolvedValue([]);
	vi.mocked(addFiles).mockResolvedValue(undefined);
	vi.mocked(getPackageManager).mockReturnValue("npm");

	vi.mocked(getUntrackedFiles).mockResolvedValue([]);
	vi.mocked(hasUnstagedChanges).mockResolvedValue(false);
	vi.mocked(evacuateFiles).mockResolvedValue(undefined);
	vi.mocked(restoreFiles).mockResolvedValue(undefined);
};

describe("runHook", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return true if hook is not in config", async () => {
		const mockConfig: TSGitHookConfig = { preCommit: { "*.ts": "lint" } };
		vi.mocked(loadConfig).mockResolvedValue(mockConfig);
		const result = await runHook("pre-push");
		expect(result).toBe(true);
	});

	it("should return false for missing config file", async () => {
		vi.mocked(loadConfig).mockResolvedValue(null);
		const result = await runHook("pre-commit");
		expect(result).toBe(false);
	});

	it("should handle mixed hook types correctly", async () => {
		const mockConfig: TSGitHookConfig = {
			preCommit: {
				"*.js": ["eslint", (files) => `eslint ${files.join(" ")}`],
			},
			prePush: "test",
		};
		vi.mocked(loadConfig).mockResolvedValue(mockConfig);
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["my-file.js"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		// Test pre-commit
		const preCommitResult = await runHook("pre-commit");
		// Custom function -> string -> shell: true
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "eslint my-file.js"],
			expect.objectContaining({ shell: true }),
		);
		expect(preCommitResult).toBe(true);

		// Test pre-push
		const prePushResult = await runHook("pre-push");
		// Simple string -> object -> shell: false (Optimization)
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "test"],
			expect.objectContaining({ shell: false }),
		);
		expect(prePushResult).toBe(true);
	});
});

describe("Hybrid Stashing logic", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should evacuate untracked files and restore them", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: ["untracked.txt"],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(evacuateFiles).toHaveBeenCalledWith(
			["untracked.txt"],
			expect.stringContaining(".git/ts-git-hooks/backups/"),
		);
		expect(restoreFiles).toHaveBeenCalledWith(
			expect.stringContaining(".git/ts-git-hooks/backups/"),
		);
	});

	it("should skip stash if there are no unstaged tracked changes", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(stashPushKeepIndex).not.toHaveBeenCalled();
		expect(stashPop).not.toHaveBeenCalled();
	});

	it("should perform surgical stash only if unstaged changes exist", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(stashPushKeepIndex).mockResolvedValue(true);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(stashPushKeepIndex).toHaveBeenCalled();
		expect(stashPop).toHaveBeenCalled();
	});
});

describe("Glob-based (file-dependent) hook execution", () => {
	beforeEach(() => {
		setupDefaultMocks();
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/index.ts", "README.md"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should execute scripts for matching glob patterns and return true", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": "tsc", "*.md": "format" },
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		// Glob hooks without custom function -> object -> shell: false
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "tsc", "src/index.ts"],
			expect.objectContaining({ shell: false }),
		);
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "format", "README.md"],
			expect.objectContaining({ shell: false }),
		);
		expect(result).toBe(true);
	});

	it("should correctly handle glob hooks with arguments (bug fix)", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": "lint --fix" },
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		// Should split "lint --fix" and use shell: false
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "lint", "--fix", "src/index.ts"],
			expect.objectContaining({ shell: false }),
		);
		expect(result).toBe(true);
	});

	it("should fallback to shell: true for glob hooks with quotes", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": 'lint --config "my config"' },
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		// Should use shell: true and quoted files
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", 'lint --config "my config" "src/index.ts"'],
			expect.objectContaining({ shell: true }),
		);
		expect(result).toBe(true);
	});

	it("should return false if a glob-based script fails", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": "test" },
		});
		vi.mocked(spawn).mockImplementationOnce(() => {
			const p = new MockChildProcess();
			simulateFailure(p);
			return p as any;
		});

		const result = await runHook("pre-commit");
		expect(result).toBe(false);
	});
});

describe("Unconditional (file-independent) hook execution", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should execute a single script and return true", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ prePush: "test" });
		vi.mocked(spawn).mockImplementationOnce(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-push");
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "test"],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});

	it("should execute an array of scripts and return true", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ prePush: ["test", "build"] });
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-push");
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "test"],
			expect.any(Object),
		);
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "build"],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});

	it("should return false if any script in an array fails", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ prePush: ["test", "build"] });
		vi.mocked(spawn)
			.mockImplementationOnce(() => {
				// test succeeds
				const p = new MockChildProcess();
				simulateSuccess(p);
				return p as any;
			})
			.mockImplementationOnce(() => {
				// build fails
				const p = new MockChildProcess();
				simulateFailure(p);
				return p as any;
			});

		const result = await runHook("pre-push");
		expect(result).toBe(false);
	});
});

describe("resolveScriptsToRun", () => {
	it("should batch identical commands for different glob patterns", async () => {
		const hookConfig: GlobHookConfig<string> = {
			"*.ts": "echo",
			"*.js": "echo",
		};
		const stagedFiles = ["a.ts", "b.js"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);

		// Expected behavior: object with script 'echo' and args ['a.ts', 'b.js']
		expect(scripts).toHaveLength(1);
		const executable = scripts[0];
		expect(typeof executable).toBe("object");
		if (typeof executable === "object") {
			expect(executable.script).toBe("echo");
			expect(executable.args).toContain("a.ts");
			expect(executable.args).toContain("b.js");
		}
	});

	it("should batch identical tuple commands if function reference is same", async () => {
		const myFn = (files: string[], script: string) =>
			`${script} --files ${files.join(",")}`;
		const hookConfig: GlobHookConfig<string> = {
			"*.ts": ["lint", myFn],
			"*.js": ["lint", myFn],
		};
		const stagedFiles = ["a.ts", "b.js"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);

		expect(scripts).toHaveLength(1);
		expect(scripts[0]).toMatch(/lint --files (a\.ts,b\.js|b\.js,a\.ts)/);
	});

	it("should NOT batch if commands are different", async () => {
		const hookConfig: GlobHookConfig<string> = {
			"*.ts": "echo1",
			"*.js": "echo2",
		};
		const stagedFiles = ["a.ts", "b.js"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);

		expect(scripts).toHaveLength(2);
	});

	it("should return matched files for glob hooks", async () => {
		const hookConfig: GlobHookConfig<string> = {
			"*.ts": "echo",
		};
		const stagedFiles = ["a.ts", "b.js"];

		const { matchedFiles } = await resolveScriptsToRun(hookConfig, stagedFiles);

		expect(matchedFiles).toEqual(["a.ts"]);
	});

	it("should return null matchedFiles for simple hooks", async () => {
		const hookConfig = "echo";
		const stagedFiles = ["a.ts"];

		const { matchedFiles } = await resolveScriptsToRun(hookConfig, stagedFiles);

		expect(matchedFiles).toBeNull();
	});
});

describe("Performance Optimizations", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should NOT call getStagedFiles for simple hook without args function", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ prePush: "test" });
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-push");

		// For pre-push, needsStash is true, so it calls getGitStatus instead of getStagedFiles
		expect(getStagedFiles).not.toHaveBeenCalled();
		expect(getGitStatus).toHaveBeenCalled();
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "test"],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});

	it("should call getGitStatus for glob-based hook", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["a.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");
		expect(getGitStatus).toHaveBeenCalled();
	});

	it("should call getGitStatus for simple hook WITH args function", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			prePush: ["lint", (files) => `echo ${files.length}`],
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["a.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-push");
		expect(getGitStatus).toHaveBeenCalled();
	});

	it("should call addFiles with force option for pre-commit hook", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/file.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(getChangedFiles).mockResolvedValue(["src/file.ts"]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(addFiles).toHaveBeenCalledWith(["src/file.ts"], true);
	});

	it("should not call addFiles with force option for non-pre-commit hooks", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ prePush: "test" });
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-push");

		expect(addFiles).not.toHaveBeenCalled();
	});

	it("should NOT stash changes for commit-msg hook", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ commitMsg: "commitlint" });
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("commit-msg");

		// It should NOT try to stash
		expect(stashPushKeepIndex).not.toHaveBeenCalled();
		expect(stashPop).not.toHaveBeenCalled();
	});

	it("should optimize getChangedFiles call for glob hooks", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": "lint" },
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/file.ts", "README.md"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		// Should only check for changes in matched files (src/file.ts)
		expect(getChangedFiles).toHaveBeenCalledWith(["src/file.ts"]);
	});

	it("should check all files for simple hooks in pre-commit", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: "lint",
		} as any);
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/file.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		// Should check for changes in ALL files (undefined args)
		expect(getChangedFiles).toHaveBeenCalledWith(undefined);
	});

	it("should use detected package manager (pnpm)", async () => {
		vi.mocked(getPackageManager).mockReturnValue("pnpm");
		vi.mocked(loadConfig).mockResolvedValue({ prePush: "test" });
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-push");

		expect(spawn).toHaveBeenCalledWith(
			"pnpm",
			["run", "test"],
			expect.any(Object),
		);
	});
});
