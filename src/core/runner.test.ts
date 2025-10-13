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

	it("should return true if hook is not in config", async () => {
		const mockConfig: TSGitHookConfig = { "pre-commit": { "*.ts": "lint" } };
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
			"pre-commit": {
				"*.js": "eslint",
			},
			"pre-push": "test",
		};
		vi.mocked(loadConfig).mockResolvedValue(mockConfig);
		vi.mocked(getStagedFiles).mockResolvedValue(["my-file.js"]);
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		// Test pre-commit
		const preCommitResult = await runHook("pre-commit");
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "eslint my-file.js"],
			expect.any(Object),
		);
		expect(preCommitResult).toBe(true);

		// Test pre-push
		const prePushResult = await runHook("pre-push");
		expect(spawn).toHaveBeenCalledWith("npm", ["run", "test"], expect.any(Object));
		expect(prePushResult).toBe(true);
	});
});

describe("Glob-based (file-dependent) hook execution", () => {
	beforeEach(() => {
		setupDefaultMocks();
		vi.mocked(getStagedFiles).mockResolvedValue(["src/index.ts", "README.md"]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should execute scripts for matching glob patterns and return true", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { "*.ts": "tsc", "*.md": "format" },
		});
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
		expect(spawn).toHaveBeenCalledWith(
			"npm",
			["run", "format README.md"],
			expect.any(Object),
		);
		expect(result).toBe(true);
	});

	it("should return false if a glob-based script fails", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { "*.ts": "test" },
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
		vi.mocked(loadConfig).mockResolvedValue({ "pre-push": "test" });
		vi.mocked(spawn).mockImplementationOnce(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-push");
		expect(spawn).toHaveBeenCalledWith("npm", ["run", "test"], expect.any(Object));
		expect(result).toBe(true);
	});

	it("should execute an array of scripts and return true", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ "pre-push": ["test", "build"] });
		vi.mocked(spawn).mockImplementation(() => {
			const p = new MockChildProcess();
			simulateSuccess(p);
			return p as any;
		});

		const result = await runHook("pre-push");
		expect(spawn).toHaveBeenCalledWith("npm", ["run", "test"], expect.any(Object));
		expect(spawn).toHaveBeenCalledWith("npm", ["run", "build"], expect.any(Object));
		expect(result).toBe(true);
	});

	it("should return false if any script in an array fails", async () => {
		vi.mocked(loadConfig).mockResolvedValue({ "pre-push": ["test", "build"] });
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

describe("Auto-Fixing and Stashing", () => {
	beforeEach(() => {
		setupDefaultMocks();
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { "*.ts": "format" },
		});
		vi.mocked(getStagedFiles).mockResolvedValue(["src/file.ts"]);
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
});