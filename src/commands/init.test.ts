import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "./init";

// Mock the entire 'node:fs' and 'node:path' modules
vi.mock("node:fs", () => ({
	promises: {
		writeFile: vi.fn(),
		access: vi.fn(),
	},
}));

const configFileName = "git-hooks.config.ts";
const tsConfigForHooksFileName = "tsconfig.githooks.json";

describe("init command", () => {
	let logSpy: vi.SpyInstance;
	let errorSpy: vi.SpyInstance;

	beforeEach(() => {
		vi.resetAllMocks();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should create both config files when none exist and root tsconfig is present", async () => {
		// Arrange
		vi.mocked(fs.access).mockImplementation((filePath) => {
			if (
				(filePath as string).endsWith(configFileName) ||
				(filePath as string).endsWith(tsConfigForHooksFileName)
			) {
				return Promise.reject(new Error("File not found"));
			}
			// Simulate root tsconfig.json existence
			if ((filePath as string).endsWith("tsconfig.json")) {
				return Promise.resolve();
			}
			return Promise.reject(new Error("Unexpected file access"));
		});

		// Act
		await init();

		// Assert
		expect(fs.writeFile).toHaveBeenCalledTimes(2);
		expect(logSpy).toHaveBeenCalledWith(
			`Configuration file created at "${configFileName}"`,
		);
		expect(logSpy).toHaveBeenCalledWith(
			`IDE-assist file created at "${tsConfigForHooksFileName}"`,
		);
	});

	it("should create tsconfig.githooks.json extending the root tsconfig", async () => {
		// Arrange
		vi.mocked(fs.access).mockImplementation((filePath) => {
			if ((filePath as string).endsWith("tsconfig.json")) {
				return Promise.resolve(); // Root tsconfig exists
			}
			return Promise.reject(new Error("File not found")); // Other files don't exist
		});

		// Act
		await init();

		// Assert
		const tsConfigCall = vi.mocked(fs.writeFile).mock.calls.find((call) =>
			(call[0] as string).endsWith(tsConfigForHooksFileName),
		);
		expect(tsConfigCall).not.toBeUndefined();
		const tsConfigContent = JSON.parse(tsConfigCall![1] as string);
		expect(tsConfigContent.extends).toBe("./tsconfig.json");
	});

	it("should create tsconfig.githooks.json without extends when root tsconfig is absent", async () => {
		// Arrange
		vi.mocked(fs.access).mockRejectedValue(new Error("File not found")); // No files exist

		// Act
		await init();

		// Assert
		const tsConfigCall = vi.mocked(fs.writeFile).mock.calls.find((call) =>
			(call[0] as string).endsWith(tsConfigForHooksFileName),
		);
		expect(tsConfigCall).not.toBeUndefined();
		const tsConfigContent = JSON.parse(tsConfigCall![1] as string);
		expect(tsConfigContent.extends).toBeUndefined();
	});

	it("should not create files if config already exists", async () => {
		// Arrange
		vi.mocked(fs.access).mockImplementation((filePath) => {
			if ((filePath as string).endsWith(configFileName)) {
				return Promise.resolve(); // Config file exists
			}
			return Promise.reject(new Error("File not found"));
		});

		// Act
		await init();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			`Configuration file "${configFileName}" already exists.`,
		);
	});
});