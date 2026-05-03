import { describe, expect, it, vi } from "vitest";
import { resolveScriptsToRun } from "./runner";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		lstat: vi.fn().mockResolvedValue({}),
	};
});

vi.mock("../utils/git", () => ({
	getStagedFiles: vi.fn(),
	getGitStatus: vi.fn(),
}));

vi.mock("./config", () => ({
	isGlobHookConfig: (_config) => true,
	isHookConfigWithOpts: (_config) => false,
	loadConfig: vi.fn(),
}));

vi.mock("micromatch", () => ({
	default: (files: string[]) => files,
}));

describe("runner injection test with shell-quote", () => {
	it("should be safe from injection when quotes are present", async () => {
		const hookConfig = {
			"*.ts": 'lint --config "conf.json"',
		};
		const stagedFiles = ["$(touch EXPLOITED).ts"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);
		expect(scripts).toHaveLength(1);

		// Should be an object for shell: false
		expect(typeof scripts[0]).toBe("object");
		const executable = scripts[0] as { script: string; args: string[] };
		expect(executable.script).toBe("lint");
		expect(executable.args).toEqual([
			"--config",
			"conf.json",
			"$(touch EXPLOITED).ts",
		]);
	});

	it("should be safe when operators are present by using quote()", async () => {
		const hookConfig = {
			"*.ts": "lint || true",
		};
		const stagedFiles = ["$(touch EXPLOITED).ts"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);
		expect(scripts).toHaveLength(1);

		// Should be a string for shell: true, but safely quoted
		expect(typeof scripts[0]).toBe("string");
		expect(scripts[0]).toBe("lint || true '$(touch EXPLOITED).ts'");
	});

	it("should correctly include script name in ArgsFn and be safe", async () => {
		const hookConfig = {
			"*.ts": ["lint", (files, _script) => `--files="${files.join(",")}"`],
		};
		const stagedFiles = ["$(touch EXPLOITED).ts"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);
		expect(scripts).toHaveLength(1);

		expect(typeof scripts[0]).toBe("object");
		const executable = scripts[0] as { script: string; args: string[] };
		expect(executable.script).toBe("lint");
		expect(executable.args).toEqual(["--files=$(touch EXPLOITED).ts"]);
	});

	it("should handle ArgsFn returning full command", async () => {
		const hookConfig = {
			"*.ts": [
				"lint",
				(files, script) => `${script} --files="${files.join(",")}"`,
			],
		};
		const stagedFiles = ["file1.ts"];

		const { scripts } = await resolveScriptsToRun(hookConfig, stagedFiles);
		expect(scripts).toHaveLength(1);

		expect(typeof scripts[0]).toBe("object");
		const executable = scripts[0] as { script: string; args: string[] };
		expect(executable.script).toBe("lint");
		expect(executable.args).toEqual(["--files=file1.ts"]);
	});
});
