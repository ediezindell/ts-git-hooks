import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { getGitStatus } from "../utils/git";
import { verify } from "./verify";

// Mock dependencies
vi.mock("../core/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../core/config")>();
	return {
		...actual,
		loadConfig: vi.fn(),
	};
});

vi.mock("../utils/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/git")>();
	return {
		...actual,
		getGitStatus: vi.fn(),
	};
});

describe("verify command", () => {
	let logSpy: vi.SpyInstance;
	let errorSpy: vi.SpyInstance;

	beforeEach(() => {
		// Logger uses console.log and console.error internally
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// Picocolors might be used, so we use stringContaining
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should verify a simple unconditional hook", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			prePush: "npm test",
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: [],
			untrackedItems: [],
			unstagedChangesExist: false,
		});

		await verify("pre-push");

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("npm test"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-push"));
	});

	it("should verify a glob-based hook with matched files", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: {
				"*.ts": "tsc",
			},
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/index.ts", "README.md"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});

		await verify("pre-commit");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("tsc src/index.ts"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Matched files (1)"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("src/index.ts"),
		);
	});

	it("should show a message when no scripts match", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			preCommit: {
				"*.js": "eslint",
			},
		});
		vi.mocked(getGitStatus).mockResolvedValue({
			stagedFiles: ["src/index.ts"],
			untrackedItems: [],
			unstagedChangesExist: false,
		});

		await verify("pre-commit");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("No scripts would be executed"),
		);
	});

	it("should handle missing configuration", async () => {
		vi.mocked(loadConfig).mockResolvedValue(null);

		await verify("pre-commit");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Configuration file not found"),
		);
	});

	it("should handle hook with no configuration", async () => {
		vi.mocked(loadConfig).mockResolvedValue({
			prePush: "test",
		});

		await verify("pre-commit");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("No configuration found for hook: pre-commit"),
		);
	});
});
