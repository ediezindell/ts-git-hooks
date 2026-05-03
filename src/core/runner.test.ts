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
	resetToTree,
	restoreFiles,
	rollbackToPreCommitState,
	saveIndexState,
	setIndexFromTree,
	stashApply,
	stashCreate,
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
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		lstat: vi.fn().mockResolvedValue({}),
	};
});

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
	vi.mocked(saveIndexState).mockResolvedValue("deadbeef");
	vi.mocked(stashCreate).mockResolvedValue(null);
	vi.mocked(stashApply).mockResolvedValue(undefined);
	vi.mocked(rollbackToPreCommitState).mockResolvedValue(undefined);
	vi.mocked(getChangedFiles).mockResolvedValue([]);
	vi.mocked(addFiles).mockResolvedValue(undefined);
	vi.mocked(getPackageManager).mockReturnValue("npm");

	vi.mocked(getUntrackedFiles).mockResolvedValue([]);
	vi.mocked(hasUnstagedChanges).mockResolvedValue(false);
	vi.mocked(evacuateFiles).mockResolvedValue(undefined);
	vi.mocked(restoreFiles).mockResolvedValue(undefined);
	vi.mocked(resetToTree).mockResolvedValue(undefined);
	vi.mocked(setIndexFromTree).mockResolvedValue(undefined);
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
				"*.js": ["eslint", (files) => files.join(" ")],
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
		// Custom function -> object -> shell: false
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "eslint", "my-file.js"],
			expect.objectContaining({ shell: false }),
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

		expect(stashCreate).not.toHaveBeenCalled();
		expect(stashApply).not.toHaveBeenCalled();
	});

	it("should perform surgical stash only if unstaged changes exist", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(stashCreate).mockResolvedValue("abc1234");
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(stashCreate).toHaveBeenCalled();
		expect(stashApply).toHaveBeenCalledWith("abc1234");
	});

	it("should rollback to origIndexTree when hook fails (no unstaged changes)", async () => {
		// Regression test: rollback must work even without unstaged changes.
		// The linter may partially modify files in the working tree before failing;
		// those changes must be cleaned up by restoring to origIndexTree.
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: false, // No unstaged changes → stashHash will be null
		});
		vi.mocked(saveIndexState).mockResolvedValue("deadbeef");
		vi.mocked(stashCreate).mockResolvedValue(null); // No stash created
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateFailure(p); // Linter fails
			return p as any;
		});

		const result = await runHook("pre-commit");

		expect(result).toBe(false);
		// Rollback must be called even though there were no unstaged changes
		expect(rollbackToPreCommitState).toHaveBeenCalledWith("deadbeef");
		expect(stashApply).not.toHaveBeenCalled(); // No stash to apply
	});

	it("should rollback before stash apply when hook fails with unstaged changes", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ preCommit: { "*.ts": "lint" } });
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(saveIndexState).mockResolvedValue("deadbeef");
		vi.mocked(stashCreate).mockResolvedValue("stashhash");
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateFailure(p); // Linter fails
			return p as any;
		});

		await runHook("pre-commit");

		// Rollback must happen BEFORE stash apply (cleaning linter changes first)
		const rollbackCallOrder = vi.mocked(rollbackToPreCommitState).mock
			.invocationCallOrder[0];
		const stashApplyCallOrder =
			vi.mocked(stashApply).mock.invocationCallOrder[0];
		expect(rollbackCallOrder).toBeLessThan(stashApplyCallOrder);
	});
});

describe("Formatter replay (replayFormatter)", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should replay scripts and skip stash apply when enabled, stash exists, and files were modified", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: { "*.ts": "format" },
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(stashCreate).mockResolvedValue("stashhash");
		vi.mocked(saveIndexState)
			.mockResolvedValueOnce("origIndex") // pre-stash
			.mockResolvedValueOnce("lintTree"); // post-lint, pre-replay
		vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		expect(result).toBe(true);
		// Scripts ran twice: once on staged-only, once on staged+unstaged
		expect(spawn).toHaveBeenCalledTimes(2);
		// Replay sequence: reset to stash WIP, then restore index to lintTree
		expect(resetToTree).toHaveBeenCalledWith("stashhash");
		expect(setIndexFromTree).toHaveBeenCalledWith("lintTree");
		// Stash apply must NOT run — unstaged changes are now in the working tree directly
		expect(stashApply).not.toHaveBeenCalled();
	});

	it("should not replay when replayFormatter is disabled (default behavior)", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": "format" },
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(stashCreate).mockResolvedValue("stashhash");
		vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(resetToTree).not.toHaveBeenCalled();
		expect(setIndexFromTree).not.toHaveBeenCalled();
		// Original behavior: stash apply runs
		expect(stashApply).toHaveBeenCalledWith("stashhash");
	});

	it("should not replay when there is no stash (no unstaged changes)", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: { "*.ts": "format" },
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});
		vi.mocked(stashCreate).mockResolvedValue(null);
		vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(resetToTree).not.toHaveBeenCalled();
		expect(setIndexFromTree).not.toHaveBeenCalled();
		// Scripts ran only once
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("should not replay when scripts didn't modify any files", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: { "*.ts": "lint" },
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(stashCreate).mockResolvedValue("stashhash");
		vi.mocked(getChangedFiles).mockResolvedValue([]); // no modifications
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		await runHook("pre-commit");

		expect(resetToTree).not.toHaveBeenCalled();
		// No formatter changes → original stash apply path is fine (no merge conflict possible)
		expect(stashApply).toHaveBeenCalledWith("stashhash");
	});

	it("should fall back to rollback path when replay scripts fail", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: { "*.ts": "format" },
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/a.ts"],
			untrackedItems: [],
			unstagedChangesExist: true,
		});
		vi.mocked(stashCreate).mockResolvedValue("stashhash");
		vi.mocked(saveIndexState)
			.mockResolvedValueOnce("origIndex")
			.mockResolvedValueOnce("lintTree");
		vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);

		// First run succeeds, replay run fails
		let callCount = 0;
		vi.mocked(spawn).mockImplementation(() => {
			callCount++;
			const p = new MockChildProcess();
			if (callCount === 1) {
				simulateSuccess(p);
			} else {
				simulateFailure(p);
			}
			return p as any;
		});

		const result = await runHook("pre-commit");

		expect(result).toBe(false);
		// Replay was attempted
		expect(resetToTree).toHaveBeenCalledWith("stashhash");
		// Rollback path runs in finally because hookSucceeded never became true
		expect(rollbackToPreCommitState).toHaveBeenCalledWith("origIndex");
		expect(stashApply).toHaveBeenCalledWith("stashhash");
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

	it("should handle glob hooks with quotes securely using shell: false", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: { "*.ts": 'lint --config "my config"' },
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		// Should use shell: false and correctly parsed arguments
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "lint", "--config", "my config", "src/index.ts"],
			expect.objectContaining({ shell: false }),
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
		const myFn = (files: string[]) => `--files ${files.join(",")}`;
		const hookConfig: GlobHookConfig<string> = {
			"*.ts": ["lint", myFn],
			"*.js": ["lint", myFn],
		};
		const stagedFiles = ["a.ts", "b.js"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);

		expect(scripts).toHaveLength(1);
		const executable = scripts[0] as { script: string; args: string[] };
		expect(executable.script).toBe("lint");
		expect(executable.args[0]).toBe("--files");
		expect(executable.args[1]).toMatch(/^(a\.ts,b\.js|b\.js,a\.ts)$/);
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
		expect(stashCreate).not.toHaveBeenCalled();
		expect(stashApply).not.toHaveBeenCalled();
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

describe("Sequential Execution logic", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should run scripts sequentially when sequential is true", async () => {
		const mockConfig: TSGitHookConfig = {
			prePush: {
				sequential: true,
				config: ["task1", "task2"],
			},
		};
		vi.mocked(loadConfig).mockResolvedValue(mockConfig);

		let activeCount = 0;
		let maxActiveCount = 0;

		vi.mocked(spawn).mockImplementation(() => {
			activeCount++;
			maxActiveCount = Math.max(maxActiveCount, activeCount);
			const p = new MockChildProcess();
			setTimeout(() => {
				activeCount--;
				p.emit("close", 0);
			}, 10);
			return p as any;
		});

		const result = await runHook("pre-push");

		expect(result).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(maxActiveCount).toBe(1); // Should only have 1 active at a time
	});

	it("should run scripts in parallel by default", async () => {
		const mockConfig: TSGitHookConfig = {
			prePush: ["task1", "task2"],
		};
		vi.mocked(loadConfig).mockResolvedValue(mockConfig);

		let activeCount = 0;
		let maxActiveCount = 0;

		vi.mocked(spawn).mockImplementation(() => {
			activeCount++;
			maxActiveCount = Math.max(maxActiveCount, activeCount);
			const p = new MockChildProcess();
			setTimeout(() => {
				activeCount--;
				p.emit("close", 0);
			}, 10);
			return p as any;
		});

		const result = await runHook("pre-push");

		expect(result).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(maxActiveCount).toBe(2); // Should have both active
	});

	it("should respect global sequential setting", async () => {
		const mockConfig: TSGitHookConfig = {
			sequential: true,
			prePush: ["task1", "task2"],
		};
		vi.mocked(loadConfig).mockResolvedValue(mockConfig);

		let activeCount = 0;
		let maxActiveCount = 0;

		vi.mocked(spawn).mockImplementation(() => {
			activeCount++;
			maxActiveCount = Math.max(maxActiveCount, activeCount);
			const p = new MockChildProcess();
			setTimeout(() => {
				activeCount--;
				p.emit("close", 0);
			}, 10);
			return p as any;
		});

		const result = await runHook("pre-push");

		expect(result).toBe(true);
		expect(maxActiveCount).toBe(1);
	});
});
