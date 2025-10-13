import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addFiles,
	getChangedFiles,
	getStagedFiles,
	hasUnstagedChanges,
	stashPop,
	stashPushKeepIndex,
} from "../utils/git";
import { loadConfig } from "./config";
import { runHook } from "./runner";

// Mock dependencies
vi.mock("./config");
vi.mock("../utils/git");
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
	vi.mocked(hasUnstagedChanges).mockResolvedValue(false);
	vi.mocked(stashPushKeepIndex).mockResolvedValue(false);
	vi.mocked(stashPop).mockResolvedValue(undefined);
	vi.mocked(getChangedFiles).mockResolvedValue([]);
	vi.mocked(addFiles).mockResolvedValue(undefined);
};

describe("runHook", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return true on successful script execution", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ "pre-commit": { "*": "lint" } });
		vi.mocked(getStagedFiles).mockResolvedValue(["anyfile.ts"]);
		vi.mocked(spawn).mockImplementationOnce(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});
		const result = await runHook("pre-commit");
		expect(result).toBe(true);
	});

	it("should return false if a script fails", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ "pre-commit": { "*": "test" } });
		vi.mocked(getStagedFiles).mockResolvedValue(["anyfile.ts"]);
		vi.mocked(spawn).mockImplementationOnce(() => {
			const p = new MockChildProcess();
			simulateFailure(p);
			return p as any;
		});
		const result = await runHook("pre-commit");
		expect(result).toBe(false);
	});

	it("should return true if hook is not in config", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ "pre-commit": { "*": "lint" } });
		const result = await runHook("pre-push");
		expect(result).toBe(true);
	});

	it("should return false for missing config file", async () => {
		vi.mocked(loadConfig).mockResolvedValue(null);
		const result = await runHook("pre-commit");
		expect(result).toBe(false);
	});
});

describe("Glob-based script execution", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should execute scripts for matching glob patterns and return true", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { "*.ts": "tsc" },
		});
		vi.mocked(getStagedFiles).mockResolvedValue(["src/index.ts"]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});
		const result = await runHook("pre-commit");
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "tsc src/index.ts"],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});

	it("should execute unconditional scripts without arguments if no files are staged", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { "*": "lint" },
		});
		// Ensure no staged files are found
		vi.mocked(getStagedFiles).mockResolvedValue([]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		// Verify that the script is called without any additional arguments
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "lint"],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});
});

describe("Auto-Fixing and Stashing", () => {
	let exitSpy: vi.SpyInstance;

	beforeEach(() => {
		setupDefaultMocks();
		vi.mocked(getStagedFiles).mockResolvedValue(["anyfile.ts"]);
		exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { "*": "format" },
		});
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should run full auto-fixing flow and return true", async () => {
		vi.mocked(hasUnstagedChanges).mockResolvedValue(true);
		vi.mocked(stashPushKeepIndex).mockResolvedValue(true);
		vi.mocked(getChangedFiles).mockResolvedValue(["src/file.ts"]);
		const result = await runHook("pre-commit");
		expect(stashPushKeepIndex).toHaveBeenCalled();
		expect(addFiles).toHaveBeenCalledWith(["src/file.ts"]);
		expect(stashPop).toHaveBeenCalled();
		expect(result).toBe(true);
	});

	it("should return false but still pop stash if script fails", async () => {
		vi.mocked(hasUnstagedChanges).mockResolvedValue(true);
		vi.mocked(stashPushKeepIndex).mockResolvedValue(true);
		vi.mocked(spawn).mockImplementationOnce(() => {
			const p = new MockChildProcess();
			simulateFailure(p);
			return p as any;
		});
		const result = await runHook("pre-commit");
		expect(stashPop).toHaveBeenCalled();
		expect(result).toBe(false);
	});

	it("should exit critically if stash pop fails", async () => {
		vi.mocked(hasUnstagedChanges).mockResolvedValue(true);
		vi.mocked(stashPushKeepIndex).mockResolvedValue(true);
		vi.mocked(stashPop).mockRejectedValue(new Error("Stash pop failed"));
		await runHook("pre-commit");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

describe("Glob-based script execution with custom arguments", () => {
	beforeEach(() => {
		setupDefaultMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should execute scripts using a custom function for arguments", async () => {
		const stagedFiles = ["src/index.ts", "src/utils.ts"];
		// This function will generate the final command string
		const customArgsFn = (files: string[]) => `lint:fix ${files.join(" ")}`;
		const finalCommand = customArgsFn(stagedFiles);

		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": {
				// The script is defined as a tuple: [scriptName, argsFunction]
				"*.ts": ["lint:fix", customArgsFn],
			},
		});
		vi.mocked(getStagedFiles).mockResolvedValue(stagedFiles);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-commit");

		// Expect spawn to be called with the command generated by the custom function
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", finalCommand],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});
});
