import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { getPackageManager } from "../utils/packageManager";
import { install } from "./install";

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

	it("should write hook files with 'npm exec' when package manager is npm", async () => {
		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const expectedContent = expect.stringContaining(
			"npm exec ts-git-hooks run",
		);

		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expectedContent,
			"utf-8",
		);
	});

	it("should write hook files with 'yarn' when package manager is yarn", async () => {
		// Arrange
		vi.mocked(getPackageManager).mockReturnValue("yarn");

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");
		const expectedContent = expect.stringContaining("yarn ts-git-hooks run");

		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expectedContent,
			"utf-8",
		);
		expect(fs.writeFile).toHaveBeenCalledWith(
			prePushPath,
			expectedContent,
			"utf-8",
		);
	});

	it("should write hook files with 'pnpm' when package manager is pnpm", async () => {
		// Arrange
		vi.mocked(getPackageManager).mockReturnValue("pnpm");

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");
		const expectedContent = expect.stringContaining("pnpm ts-git-hooks run");

		expect(fs.writeFile).toHaveBeenCalledWith(
			preCommitPath,
			expectedContent,
			"utf-8",
		);
		expect(fs.writeFile).toHaveBeenCalledWith(
			prePushPath,
			expectedContent,
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
			"ts-git-hooks installed successfully.",
		);
		expect(console.log).toHaveBeenCalledWith("  - pre-commit");
		expect(console.log).toHaveBeenCalledWith("  - pre-push");
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
			"Failed to install git hooks:",
			expect.any(Error),
		);
		expect(console.error).toHaveBeenCalledWith(
			"Failed to install git hooks:",
			expect.objectContaining({ message: errorMessage }),
		);
	});
});
