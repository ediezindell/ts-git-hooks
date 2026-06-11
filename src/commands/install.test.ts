import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { getPackageManager } from "../utils/packageManager";
import { getDistCliPath, install } from "./install";

// Mock dependencies
vi.mock("node:fs", () => ({
	promises: {
		mkdir: vi.fn(),
		writeFile: vi.fn(),
		chmod: vi.fn(),
		readFile: vi.fn(),
		access: vi.fn().mockRejectedValue(new Error("File not found")), // Default to not found
	},
}));
vi.mock("../core/config");
vi.mock("../utils/packageManager");

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");

describe("install command", () => {
	beforeEach(() => {
		// Reset mocks before each test
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { run: ["lint"] },
			"pre-push": { run: ["test"] },
		});
		vi.mocked(getPackageManager).mockReturnValue("npm");
		const pkg = { scripts: { lint: "eslint .", test: "vitest" } };
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should create .git/hooks directory if it does not exist", async () => {
		// Arrange
		vi.mocked(fs.access).mockRejectedValueOnce(new Error("Dir not found")); // For .git/hooks

		// Act
		await install();

		// Assert
		expect(fs.mkdir).toHaveBeenCalledWith(gitHooksDir, { recursive: true });
	});

	it("should write hook files with optimized script when package manager is npm", async () => {
		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const expectedContent = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec npm exec ts-git-hooks run pre-commit
fi`;

		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expect.stringContaining(expectedContent),
			"utf-8",
		);
	});

	it("should write hook files with optimized script when package manager is yarn", async () => {
		// Arrange
		vi.mocked(getPackageManager).mockReturnValue("yarn");

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");

		const expectedContentPreCommit = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec yarn ts-git-hooks run pre-commit
fi`;

		const expectedContentPrePush = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-push
else
  exec yarn ts-git-hooks run pre-push
fi`;

		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expect.stringContaining(expectedContentPreCommit),
			"utf-8",
		);
		expect(fs.writeFile).toHaveBeenCalledWith(
			prePushPath,
			expect.stringContaining(expectedContentPrePush),
			"utf-8",
		);
	});

	it("should write hook files with optimized script when package manager is pnpm", async () => {
		// Arrange
		vi.mocked(getPackageManager).mockReturnValue("pnpm");

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");

		const expectedContentPreCommit = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec pnpm ts-git-hooks run pre-commit
fi`;

		const expectedContentPrePush = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-push
else
  exec pnpm ts-git-hooks run pre-push
fi`;

		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expect.stringContaining(expectedContentPreCommit),
			"utf-8",
		);
		expect(fs.writeFile).toHaveBeenCalledWith(
			prePushPath,
			expect.stringContaining(expectedContentPrePush),
			"utf-8",
		);
	});

	it("should make the hook files executable", async () => {
		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");

		expect(fs.chmod).toHaveBeenCalledWith(preCommitPath, 0o755);
		expect(fs.chmod).toHaveBeenCalledWith(prePushPath, 0o755);
	});

	it("should log installed hooks to the console", async () => {
		// Act
		await install();

		// Assert
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("ts-git-hooks installed successfully."),
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("  - pre-commit"),
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("  - pre-push"),
		);
	});

	it("should handle the case where no config is found", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue(null);

		// Act
		await install();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("Configuration file not found or is empty."),
		);
	});

	it("should log an error if package manager detection fails", async () => {
		// Arrange
		const errorMessage = "Could not determine package manager.";
		vi.mocked(getPackageManager).mockImplementation(() => {
			throw new Error(errorMessage);
		});

		// Act
		await install();

		// Assert
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to install git hooks:"),
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(errorMessage),
		);
	});

	it("should skip invalid hook names for security", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit; touch exploited": { run: ["lint"] },
		} as any);

		// Act
		await install();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	it("should write the optimized direct-node branch when getDistCliPath resolves", async () => {
		const originalArgv1 = process.argv[1];
		process.argv[1] = "/abs/path/to/node_modules/ts-git-hooks/dist/cli.js";
		try {
			await install();

			const preCommitPath = path.join(gitHooksDir, "pre-commit");
			const expectedOptimized = `if [ -f /abs/path/to/node_modules/ts-git-hooks/dist/cli.js ]; then
  exec node --experimental-strip-types /abs/path/to/node_modules/ts-git-hooks/dist/cli.js run pre-commit
elif [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec npm exec ts-git-hooks run pre-commit
fi`;

			expect(fs.writeFile).toHaveBeenCalledWith(
				preCommitPath,
				expect.stringContaining(expectedOptimized),
				"utf-8",
			);
		} finally {
			process.argv[1] = originalArgv1;
		}
	});

	it("should still write hook files for normal hooks when global options are present", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			sequential: true,
			replayFormatter: true,
			preCommit: "lint",
		} as any);

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expect.stringContaining("ts-git-hooks run pre-commit"),
			"utf-8",
		);
		// Confirm only 1 hook file (not sequential or replay-formatter)
		expect(fs.writeFile).toHaveBeenCalledTimes(1);
	});

	it("should not write a hook file for the global option 'replayFormatter'", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: "lint",
		} as any);

		// Act
		await install();

		// Assert
		const replayFormatterPath = path.join(gitHooksDir, "replay-formatter");
		expect(fs.writeFile).not.toHaveBeenCalledWith(
			replayFormatterPath,
			expect.anything(),
			expect.anything(),
		);
	});

	it("should not write a hook file for the global option 'sequential'", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			sequential: true,
			preCommit: "lint",
		} as any);

		// Act
		await install();

		// Assert
		const sequentialPath = path.join(gitHooksDir, "sequential");
		expect(fs.writeFile).not.toHaveBeenCalledWith(
			sequentialPath,
			expect.anything(),
			expect.anything(),
		);
	});

	it("should shell-quote cliPath that contains spaces or single quotes", async () => {
		const originalArgv1 = process.argv[1];
		process.argv[1] = "/Users/o'brien/My Projects/dist/cli.js";
		try {
			await install();

			// shell-quote chooses double quotes when the value contains a single quote;
			// the path is preserved verbatim inside the quotes.
			const quoted = `"/Users/o'brien/My Projects/dist/cli.js"`;
			const preCommitPath = path.join(gitHooksDir, "pre-commit");

			expect(fs.writeFile).toHaveBeenCalledWith(
				preCommitPath,
				expect.stringContaining(`if [ -f ${quoted} ]`),
				"utf-8",
			);
			expect(fs.writeFile).toHaveBeenCalledWith(
				preCommitPath,
				expect.stringContaining(
					`exec node --experimental-strip-types ${quoted} run pre-commit`,
				),
				"utf-8",
			);
		} finally {
			process.argv[1] = originalArgv1;
		}
	});
});

describe("getDistCliPath", () => {
	const originalArgv1 = process.argv[1];

	afterEach(() => {
		process.argv[1] = originalArgv1;
	});

	it("returns the entry path when it ends with cli.js", () => {
		process.argv[1] = "/abs/path/dist/cli.js";
		expect(getDistCliPath()).toBe("/abs/path/dist/cli.js");
	});

	it("returns null when entry does not end with cli.js (e.g. test runner)", () => {
		process.argv[1] = "/abs/path/node_modules/vitest/dist/runner.mjs";
		expect(getDistCliPath()).toBeNull();
	});

	it("returns null when process.argv[1] is empty", () => {
		process.argv[1] = "";
		expect(getDistCliPath()).toBeNull();
	});
});
