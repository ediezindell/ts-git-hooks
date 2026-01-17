import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "./init";

// Mock dependencies
vi.mock("node:fs", () => ({
	promises: {
		access: vi.fn(),
		writeFile: vi.fn(),
		readFile: vi.fn(),
	},
}));

// Mock the type generator module
vi.mock("../core/type-generator", () => ({
	generateScriptTypes: vi.fn(),
}));

describe("init command", () => {
	let logSpy: vi.SpyInstance;

	beforeEach(() => {
		vi.resetAllMocks();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should create a config file and generate types if config does not exist", async () => {
		// Arrange
		vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
		const configFilePath = path.join(process.cwd(), "git-hooks.config.ts");
		const { generateScriptTypes } = await import("../core/type-generator");

		// Act
		await init();

		// Assert
		expect(fs.writeFile).toHaveBeenCalledWith(
			configFilePath,
			expect.any(String), // We don't need to test the exact content here
			"utf-8",
		);
		expect(generateScriptTypes).toHaveBeenCalledOnce();
		expect(logSpy).toHaveBeenCalledWith(
			'Configuration file created at "git-hooks.config.ts"',
		);
	});

	it("should not create a config file or generate types if one already exists", async () => {
		// Arrange
		vi.mocked(fs.access).mockResolvedValue(undefined);
		const { generateScriptTypes } = await import("../core/type-generator");

		// Act
		await init();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(generateScriptTypes).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			'Configuration file "git-hooks.config.ts" already exists.',
		);
	});
});
