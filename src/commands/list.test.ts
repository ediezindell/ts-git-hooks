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

	it("should list all configured hooks and their scripts", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { run: "lint" },
			"pre-push": { run: ["test", "build"] },
		});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith("Configured git hooks:");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-commit"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("lint"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-push"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("test, build"));
	});

	it("should correctly list glob-based configurations", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": {
				"*.{js,ts}": "lint",
				"*.css": ["stylelint"],
			},
			"pre-push": {
				run: "test",
			},
		});

		// Act
		await list();

		// Assert
		expect(logSpy).toHaveBeenCalledWith("Configured git hooks:");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-commit"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("pre-push"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("test"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("*.{js,ts}"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("lint"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("*.css"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("stylelint"));
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
