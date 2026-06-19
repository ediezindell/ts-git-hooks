import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { list } from "./list";

// Mock dependencies
vi.mock("../core/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../core/config")>();
	return {
		...actual,
		loadConfig: vi.fn(),
	};
});

describe("list command", () => {
	let logSpy: vi.SpyInstance;
	let errorSpy: vi.SpyInstance;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should list unconditional hooks (string and array) and handle camelCase", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-push": "test",
			"post-merge": ["build", "notify"],
		});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Configured git hooks:"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("pre-push: test"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("post-merge: build, notify"),
		);
	});

	it("should correctly list glob-based configurations", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": {
				"*.{js,ts}": "lint",
				"*.css": ["stylelint"],
			},
		});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Configured git hooks:"),
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-commit:"));
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("*.{js,ts}: lint"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("*.css: stylelint"),
		);
	});

	it("should still list normal hooks when global options are present", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			sequential: true,
			replayFormatter: true,
			preCommit: "lint",
			prePush: "test",
		} as any);

		// Act
		await list();

		// Assert
		const allLogs = logSpy.mock.calls.flat().join("\n");
		expect(allLogs).toContain("pre-commit: lint");
		expect(allLogs).toContain("pre-push: test");
		expect(allLogs).not.toContain("sequential");
		expect(allLogs).not.toContain("replay-formatter");
	});

	it("should not list 'replayFormatter' as a hook", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: "lint",
		} as any);

		// Act
		await list();

		// Assert
		const allLogs = logSpy.mock.calls.flat().join("\n");
		expect(allLogs).not.toContain("replay-formatter");
		expect(allLogs).toContain("pre-commit");
	});

	it("should display a message if no hooks are configured", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("No hooks configured."),
		);
	});

	it("should handle a missing configuration file", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue(null);

		// Act
		await list();

		// Assert
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Configuration file not found."),
		);
	});
});
