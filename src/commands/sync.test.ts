import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sync } from "./sync";

// Mock the 'node:fs' module
vi.mock("node:fs", () => ({
	promises: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
	},
}));

describe("sync command", () => {
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

	it("should generate a type definition file from package.json scripts", async () => {
		// Arrange
		const fakePackageJson = {
			scripts: {
				test: "vitest",
				lint: "biome lint .",
				build: "tsc",
			},
		};
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(fakePackageJson));
		const expectedTypeDefContent =
			'export type PackageScripts = "test" | "lint" | "build";\n';

		// Act
		await sync();

		// Assert
		expect(fs.readFile).toHaveBeenCalledWith("package.json", "utf-8");
		expect(fs.writeFile).toHaveBeenCalledWith(
			"git-hooks.d.ts",
			expectedTypeDefContent,
			"utf-8",
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Type definitions for npm scripts have been updated in 'git-hooks.d.ts'.",
			),
		);
	});

	it("should handle an empty scripts object in package.json", async () => {
		// Arrange
		const fakePackageJson = { scripts: {} };
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(fakePackageJson));
		const expectedTypeDefContent = "export type PackageScripts = never;\n";

		// Act
		await sync();

		// Assert
		expect(fs.writeFile).toHaveBeenCalledWith(
			"git-hooks.d.ts",
			expectedTypeDefContent,
			"utf-8",
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Type definitions for npm scripts have been updated in 'git-hooks.d.ts'.",
			),
		);
	});

	it("should log an error if package.json is not found", async () => {
		// Arrange
		const notFoundError = new Error("File not found");
		(notFoundError as any).code = "ENOENT";
		vi.mocked(fs.readFile).mockRejectedValue(notFoundError);

		// Act
		await sync();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Error: package.json not found in the current directory.",
			),
		);
	});
});
