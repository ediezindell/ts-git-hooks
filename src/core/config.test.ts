import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetConfig, _setConfigFileName, loadConfig } from "./config";

describe("loadConfig validation", () => {
	let testConfigPath: string;
	let currentConfigName: string;

	beforeEach(async () => {
		_resetConfig();
		vi.spyOn(console, "warn").mockImplementation(() => {});
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

	it("should warn when configuration is invalid", async () => {
		await writeTestConfig(
			"invalid",
			`
      export const config = {
        "pre-commit": 123
      };
    `,
		);

		await loadConfig();

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining(`Invalid configuration in ${currentConfigName}:`),
			expect.any(Object),
		);
	});

	it("should NOT warn when configuration is valid", async () => {
		await writeTestConfig(
			"valid",
			`
      export const config = {
        "pre-commit": { "*.ts": "lint" },
        "pre-push": ["test", "build"]
      };
    `,
		);

		await loadConfig();

		expect(console.warn).not.toHaveBeenCalled();
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
	});
});
