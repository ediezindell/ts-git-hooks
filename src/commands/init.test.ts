import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "./init";
import * as typeGenerator from "../core/type-generator";

vi.mock("node:fs", () => ({
	promises: {
		access: vi.fn(),
		writeFile: vi.fn(),
	},
}));

vi.mock("../core/type-generator");

describe("init command", () => {
	let logSpy: vi.SpyInstance;

	beforeEach(() => {
		vi.resetAllMocks();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should create a dynamic, type-safe config based on existing scripts", async () => {
		// Arrange
		const existingScripts = ["lint", "test", "build"];
		vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
		vi.mocked(typeGenerator.generateScriptTypes).mockResolvedValue(
			existingScripts,
		);
		const configFilePath = path.join(process.cwd(), "git-hooks.config.ts");

		// Act
		await init();

		// Assert
		expect(typeGenerator.generateScriptTypes).toHaveBeenCalledOnce();
		const writeFileCall = vi.mocked(fs.writeFile).mock.calls[0];
		expect(writeFileCall[0]).toBe(configFilePath);
		// Using .toContain to avoid brittle tests with spacing/formatting
		expect(writeFileCall[1]).toContain("pre-commit:");
		expect(writeFileCall[1]).toContain("'lint'");
		expect(writeFileCall[1]).toContain("'test'");
		expect(writeFileCall[1]).toContain("pre-push:");
		expect(writeFileCall[1]).toContain("'build'");
		expect(logSpy).toHaveBeenCalledWith(
			'Configuration file created at "git-hooks.config.ts"',
		);
	});

	it("should create a config with commented out examples if no relevant scripts exist", async () => {
		// Arrange
		const existingScripts = ["dev", "start"];
		vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
		vi.mocked(typeGenerator.generateScriptTypes).mockResolvedValue(
			existingScripts,
		);
		const configFilePath = path.join(process.cwd(), "git-hooks.config.ts");

		// Act
		await init();

		// Assert
		const writeFileCall = vi.mocked(fs.writeFile).mock.calls[0];
		expect(writeFileCall[0]).toBe(configFilePath);
		expect(writeFileCall[1]).toContain("// 'pre-commit'");
		expect(writeFileCall[1]).toContain("// 'pre-push'");
	});

	it("should not create a file and log message if one already exists", async () => {
		// Arrange
		vi.mocked(fs.access).mockResolvedValue(undefined);

		// Act
		await init();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(typeGenerator.generateScriptTypes).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			'Configuration file "git-hooks.config.ts" already exists.',
		);
	});
});