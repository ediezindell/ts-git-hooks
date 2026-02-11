import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("CLI Distribution Test (E2E)", () => {
	const rootDir = process.cwd();
	const distPath = path.join(rootDir, "bin/cli.js");
	let testDir: string;

	beforeAll(async () => {
		// 1. Create a temporary directory for testing
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-git-hooks-test-"));

		// 2. Change process directory to avoid any accidental writes to the project root
		process.chdir(testDir);

		// 3. Initialize git in the temp dir
		execSync("git init", { cwd: testDir });
		// 4. Create a dummy package.json
		await fs.writeFile(
			path.join(testDir, "package.json"),
			JSON.stringify({
				name: "test-project",
				scripts: {
					lint: "echo lint",
					test: "echo test",
					format: "echo format",
					build: "echo build",
				},
			}),
			"utf-8",
		);
	}, 20000);

	afterAll(async () => {
		// Change back to root directory before removing testDir
		process.chdir(rootDir);

		// Cleanup the temporary directory
		await fs.rm(testDir, { recursive: true, force: true });

		// Extra safety: Ensure no leftover files in the actual project root
		// if something went wrong and paths were misresolved.
		const leftovers = ["git-hooks.config.ts", "git-hooks.d.ts"];
		for (const file of leftovers) {
			const filePath = path.join(rootDir, file);
			try {
				const stats = await fs.stat(filePath);
				if (stats.isFile()) {
					// We only want to remove it if it was created very recently (during test)
					// but for safety in E2E, it's better to just ensure the test environment is clean.
					// However, removing files from rootDir is dangerous.
					// A better approach is to ensure they are NEVER created there.
				}
			} catch {
				// File doesn't exist, which is good.
			}
		}
	});

	const runCLI = (args: string) => {
		const cmd = `node ${distPath} ${args}`;
		try {
			const result = execSync(cmd, {
				cwd: testDir,
				encoding: "utf-8",
				env: { ...process.env, NODE_ENV: "production", NO_COLOR: "1" },
				stdio: "pipe",
			});
			return result;
		} catch (error: unknown) {
			const err = error as { stdout?: string; stderr?: string };
			return (err.stdout || "") + (err.stderr || "");
		}
	};

	it("should complete a full lifecycle", async () => {
		// 1. Init
		const initOutput = runCLI("init");
		expect(initOutput).toContain("Configuration file created");

		// 2. List (Verify config loading)
		const listOutput = runCLI("list");
		expect(listOutput).toContain("Configured git hooks:");
		expect(listOutput).toContain("pre-commit");

		// 3. Install
		const installOutput = runCLI("install");
		expect(installOutput).toContain("ts-git-hooks installed successfully");

		const preCommitPath = path.join(testDir, ".git/hooks/pre-commit");
		const preCommitExists = await fs
			.access(preCommitPath)
			.then(() => true)
			.catch(() => false);
		expect(preCommitExists).toBe(true);

		// 4. Run (Verify that the runner actually executes scripts)
		// The default config from 'init' includes 'lint' and 'test' for pre-commit.
		// Our dummy package.json has: "lint": "echo lint", "test": "echo test"
		// We create a dummy file to match the glob: *.{js,ts,jsx,tsx}
		await fs.writeFile(
			path.join(testDir, "test.ts"),
			"console.log('test');",
			"utf-8",
		);

		// We need to stage the file because the runner (via git-ls-files) only sees tracked files
		execSync("git add test.ts", { cwd: testDir });

		const runOutput = runCLI("run pre-commit");
		expect(runOutput).toContain("Running scripts for pre-commit");
		expect(runOutput).toContain("lint"); // Output from 'echo lint'
		expect(runOutput).toContain("test"); // Output from 'echo test'

		// 5. Uninstall
		const uninstallOutput = runCLI("uninstall");
		expect(uninstallOutput).toContain("ts-git-hooks uninstalled successfully");

		const preCommitStillExists = await fs
			.access(preCommitPath)
			.then(() => true)
			.catch(() => false);
		expect(preCommitStillExists).toBe(false);
	}, 30000);
});
