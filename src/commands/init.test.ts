import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "./init";

// Mock the entire 'node:fs' module
vi.mock("node:fs", () => ({
	promises: {
		writeFile: vi.fn(),
		access: vi.fn(),
	},
}));

const defaultConfigContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';
import pkg from './package.json' with { type: 'json' };

// Note: "build" script is added to "pre-commit" by default.
// You can remove it if you don't want to run it on every commit.
export const config: TSGitHookConfig<keyof typeof pkg.scripts> = {
  'pre-commit': {
    '*.{js,ts,jsx,tsx}': 'lint',
    '*.{md,json}': 'format',
  },
  'pre-push': {
    '*': 'build',
  },
};
`;

describe("init command", () => {
	let logSpy: vi.SpyInstance;

	beforeEach(() => {
		// Reset mocks and spies before each test
		vi.resetAllMocks();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		// Restore all mocks after each test
		vi.restoreAllMocks();
	});

	it("should create a config file if one does not exist", async () => {
		// Arrange
		vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
		const expectedPath = path.join(process.cwd(), "ts-git-hooks.config.ts");

		// Act
		await init();

		// Assert
		expect(fs.writeFile).toHaveBeenCalledOnce();
		expect(fs.writeFile).toHaveBeenCalledWith(
			expectedPath,
			defaultConfigContent,
			"utf-8",
		);
		expect(logSpy).toHaveBeenCalledWith(
			"Configuration file created at ts-git-hooks.config.ts",
		);
	});

	it("should not create a config file if one already exists", async () => {
		// Arrange
		vi.mocked(fs.access).mockResolvedValue(undefined);

		// Act
		await init();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith("Configuration file already exists.");
	});
});
