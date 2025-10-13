import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { list } from "./list";

// Mock dependencies
vi.mock("../core/config");

describe("list command", () => {
	let logSpy: vi.SpyInstance;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should list unconditional hooks (string and array)", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-push": "test",
			"post-merge": ["build", "notify"],
		});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith("Configured git hooks:");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-push: test"));
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
		expect(logSpy).toHaveBeenCalledWith("Configured git hooks:");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-commit:"));
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("*.{js,ts}: lint"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("*.css: stylelint"),
		);
	});

	it("should display a message if no hooks are configured", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith("No hooks configured.");
	});

	it("should handle a missing configuration file", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue(null);

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith("Configuration file not found.");
	});
});