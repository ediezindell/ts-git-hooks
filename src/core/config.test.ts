import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetConfig,
	_setConfigFileName,
	isGlobHookConfig,
	isHookConfigWithOpts,
	loadConfig,
} from "./config";

describe("loadConfig validation", () => {
	let testConfigPath: string;
	let currentConfigName: string;

	beforeEach(async () => {
		_resetConfig();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (testConfigPath) {
			try {
				await fs.unlink(testConfigPath);
			} catch {
				// Ignore if file doesn't exist
			}
		}
	});

	async function writeTestConfig(name: string, content: string) {
		currentConfigName = `${name}.${Date.now()}.${Math.random().toString(36).slice(2)}.ts`;
		_setConfigFileName(currentConfigName);
		testConfigPath = path.join(process.cwd(), currentConfigName);
		await fs.writeFile(testConfigPath, content);
	}

	it("should fail-closed (return null + log error) when configuration is invalid", async () => {
		await writeTestConfig(
			"invalid",
			`
      export const config = {
        "pre-commit": 123
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
		);
	});

	it("should NOT log when configuration is valid", async () => {
		await writeTestConfig(
			"valid",
			`
      export const config = {
        "pre-commit": { "*.ts": "lint" },
        "pre-push": ["test", "build"]
      };
    `,
		);

		const config = await loadConfig();

		expect(config).not.toBeNull();
		expect(console.warn).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it("should handle hook names in kebab-case and camelCase", async () => {
		await writeTestConfig(
			"naming",
			`
      export const config = {
        "pre-commit": "lint",
        prePush: "test"
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toEqual({
			preCommit: "lint",
			prePush: "test",
		});
		expect(console.warn).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it("should fail-closed when per-hook config contains replayFormatter (only allowed at top level)", async () => {
		await writeTestConfig(
			"per-hook-replay-formatter",
			`
      export const config = {
        "pre-commit": {
          replayFormatter: true,
          config: { "*.ts": "lint" }
        }
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
		);
	});

	it("should accept valid string command, tuple command, and array of commands", async () => {
		await writeTestConfig(
			"valid-commands",
			`
      export const config = {
        "pre-push": "test",
        "pre-commit": [["lint", () => []], "typecheck"]
      };
    `,
		);

		const config = await loadConfig();

		expect(config).not.toBeNull();
		expect(config).toEqual({
			prePush: "test",
			preCommit: [["lint", expect.any(Function)], "typecheck"],
		});
		expect(console.error).not.toHaveBeenCalled();
	});

	it("should reject a command list containing a tuple with empty script name", async () => {
		await writeTestConfig(
			"empty-tuple-command",
			`
      export const config = {
        "pre-push": [["", () => []]]
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
		);
	});

	it("should reject whitespace-only command ('   ')", async () => {
		await writeTestConfig(
			"whitespace-command",
			`
      export const config = {
        "pre-push": "   "
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Command must not be empty"),
		);
	});

	it("should reject empty string command in glob value ({ '*.ts': '' })", async () => {
		await writeTestConfig(
			"empty-glob-command",
			`
      export const config = {
        "pre-commit": { "*.ts": "" }
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Command must not be empty"),
		);
	});

	it("should reject empty string command (prePush: '')", async () => {
		await writeTestConfig(
			"empty-command",
			`
      export const config = {
        "pre-push": ""
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toBeNull();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Command must not be empty"),
		);
	});

	it("should handle configuration with sequential options", async () => {
		await writeTestConfig(
			"sequential",
			`
      export const config = {
        sequential: true,
        "pre-commit": {
          sequential: false,
          config: { "*.ts": "lint" }
        }
      };
    `,
		);

		const config = await loadConfig();

		expect(config).toEqual({
			sequential: true,
			preCommit: {
				sequential: false,
				config: { "*.ts": "lint" },
			},
		});
		expect(console.warn).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});
});

describe("isHookConfigWithOpts / isGlobHookConfig type guards", () => {
	it("should NOT treat a glob map with a literal 'config' pattern key as an options wrapper", () => {
		const value = { config: "lint", "*.ts": "tsc" };

		expect(isHookConfigWithOpts(value)).toBe(false);
		expect(isGlobHookConfig(value)).toBe(true);
	});

	it("should treat { sequential, config } as an options wrapper", () => {
		const value = { sequential: true, config: "lint" };

		expect(isHookConfigWithOpts(value)).toBe(true);
		expect(isGlobHookConfig(value)).toBe(false);
	});

	it("should still treat { config } (only the 'config' key) as an options wrapper", () => {
		const value = { config: "lint" };

		expect(isHookConfigWithOpts(value)).toBe(true);
		expect(isGlobHookConfig(value)).toBe(false);
	});

	it("should treat a plain glob map as a glob hook config, not an options wrapper", () => {
		const value = { "*.ts": "tsc" };

		expect(isGlobHookConfig(value)).toBe(true);
		expect(isHookConfigWithOpts(value)).toBe(false);
	});
});
