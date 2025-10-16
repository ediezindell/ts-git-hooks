import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	generateScriptTypes,
	generateTypeDefContent,
} from "./type-generator";

vi.mock("node:fs", () => ({
	promises: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
	},
}));

describe("generateTypeDefContent", () => {
	it("should create a union type of script names", () => {
		const scripts = ["test", "lint", "build"];
		const result = generateTypeDefContent(scripts);
		expect(result).toBe('export type PackageScripts = "test" | "lint" | "build";\n');
	});

	it("should return 'never' for an empty array", () => {
		const scripts: string[] = [];
		const result = generateTypeDefContent(scripts);
		expect(result).toBe("export type PackageScripts = never;\n");
	});
});

describe("generateScriptTypes", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should read package.json and write the correct type definition file", async () => {
		// Arrange
		const fakePackageJson = {
			scripts: {
				test: "vitest",
				lint: "biome lint .",
			},
		};
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify(fakePackageJson),
		);
		const expectedContent = 'export type PackageScripts = "test" | "lint";\n';

		// Act
		const scriptNames = await generateScriptTypes();

		// Assert
		expect(fs.readFile).toHaveBeenCalledWith("package.json", "utf-8");
		expect(fs.writeFile).toHaveBeenCalledWith(
			"git-hooks.d.ts",
			expectedContent,
			"utf-8",
		);
		expect(scriptNames).toEqual(["test", "lint"]);
	});

	it("should throw an error if package.json is not found", async () => {
		// Arrange
		const notFoundError = new Error("File not found");
		(notFoundError as any).code = "ENOENT";
		vi.mocked(fs.readFile).mockRejectedValue(notFoundError);

		// Act & Assert
		await expect(generateScriptTypes()).rejects.toThrow();
	});
});