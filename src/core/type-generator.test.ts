import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateScriptTypes } from "./type-generator";

vi.mock("node:fs", () => ({
	promises: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
	},
}));

vi.mock("../utils/logger", () => ({
	logger: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

describe("type-generator injection", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("should escape script names in generated type definitions using JSON.stringify", async () => {
		const pkgJson = {
			scripts: {
				safe: "echo safe",
				// Injection attempt with quotes and semicolons
				"unsafe\"; console.log('exploited');//": "echo unsafe",
				// Injection attempt with backslashes
				"backslash\\": "echo backslash",
				// Injection attempt with nested quotes
				"nested'\"'quotes": "echo nested",
			},
		};

		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkgJson));

		await generateScriptTypes();

		const writeFileCall = vi.mocked(fs.writeFile).mock.calls[0];
		const content = writeFileCall[1] as string;

		// The malicious script names should be safely escaped
		expect(content).toContain('"safe"');
		expect(content).toContain('"unsafe\\"; console.log(\'exploited\');//"');
		expect(content).toContain('"backslash\\\\"');
		expect(content).toContain('"nested\'\\"\'quotes"');

		// The entire content should be valid TypeScript type definition
		expect(content).toBe(
			'export type PackageScripts = "safe" | "unsafe\\"; console.log(\'exploited\');//" | "backslash\\\\" | "nested\'\\"\'quotes";\n',
		);
	});

	it("should handle empty scripts object", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

		await generateScriptTypes();

		const writeFileCall = vi.mocked(fs.writeFile).mock.calls[0];
		const content = writeFileCall[1] as string;

		expect(content).toBe("export type PackageScripts = never;\n");
	});
});
