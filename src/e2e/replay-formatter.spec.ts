import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * E2E for the formatter-replay PoC.
 *
 * Scenario: a single-line file `target.txt` has THREE different values across
 *   - HEAD:        "original\n"
 *   - Index:       "staged\n"   (staged change, not yet committed)
 *   - Working tree:"unstaged\n" (further unstaged change on top)
 * The pre-commit script uppercases each matched file. With the legacy
 * stash-apply flow, `git stash apply` does a 3-way merge of (base=HEAD,
 * ours=LINT_TREE, theirs=stash WIP) — both sides modified the same line, so it
 * conflicts. With `replayFormatter: true`, the script is re-run on the
 * (staged + unstaged) state, the index is restored to the lint result, and
 * stash apply is bypassed entirely.
 */
describe("Formatter replay (E2E)", () => {
	const rootDir = process.cwd();
	const distPath = path.join(rootDir, "dist/cli.js");
	let testDir: string;

	// Note: `npm run build` must have been run before invoking this suite.
	// (Same convention as dist.spec.ts — concurrent rebuilds race with other E2E
	// specs that read dist/cli.js.)

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsgh-replay-"));
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	const writeRepo = async (replayFormatter: boolean) => {
		// Init repo
		execSync("git init -q -b main", { cwd: testDir });
		execSync("git config user.email test@example.com", { cwd: testDir });
		execSync("git config user.name test", { cwd: testDir });
		execSync("git config commit.gpgsign false", { cwd: testDir });

		// package.json with an "uppercase" script that mutates each argument file.
		await fs.writeFile(
			path.join(testDir, "package.json"),
			JSON.stringify({
				name: "tsgh-replay-fixture",
				scripts: { uppercase: "node uppercase.mjs" },
			}),
			"utf-8",
		);

		// Formatter: uppercases each path passed as an argument.
		await fs.writeFile(
			path.join(testDir, "uppercase.mjs"),
			[
				"import { readFile, writeFile } from 'node:fs/promises';",
				"const files = process.argv.slice(2);",
				"for (const f of files) {",
				"  const c = await readFile(f, 'utf8');",
				"  await writeFile(f, c.toUpperCase());",
				"}",
			].join("\n"),
			"utf-8",
		);

		// ts-git-hooks config
		await fs.writeFile(
			path.join(testDir, "git-hooks.config.ts"),
			[
				"export const config = {",
				replayFormatter ? "  replayFormatter: true," : "",
				"  preCommit: { '*.txt': 'uppercase' },",
				"};",
			]
				.filter(Boolean)
				.join("\n"),
			"utf-8",
		);

		// Initial commit
		await fs.writeFile(path.join(testDir, "target.txt"), "original\n", "utf-8");
		execSync(
			"git add target.txt package.json uppercase.mjs git-hooks.config.ts",
			{ cwd: testDir },
		);
		execSync('git commit -q -m "initial"', { cwd: testDir });

		// Stage a change that differs from HEAD
		await fs.writeFile(path.join(testDir, "target.txt"), "staged\n", "utf-8");
		execSync("git add target.txt", { cwd: testDir });

		// Then an unstaged change on top — different again
		await fs.writeFile(path.join(testDir, "target.txt"), "unstaged\n", "utf-8");
	};

	const runCLI = (args: string): { code: number; output: string } => {
		try {
			const output = execSync(`node ${distPath} ${args}`, {
				cwd: testDir,
				encoding: "utf-8",
				env: { ...process.env, NODE_ENV: "production", NO_COLOR: "1" },
				stdio: "pipe",
			});
			return { code: 0, output };
		} catch (error: unknown) {
			const err = error as {
				status?: number;
				stdout?: string;
				stderr?: string;
			};
			return {
				code: err.status ?? 1,
				output: (err.stdout || "") + (err.stderr || ""),
			};
		}
	};

	const readWorkingTree = async () =>
		await fs.readFile(path.join(testDir, "target.txt"), "utf-8");

	const readIndex = () =>
		execSync("git show :target.txt", { cwd: testDir, encoding: "utf-8" });

	it("with replayFormatter=true: succeeds, index has formatted-staged, working tree has formatted-unstaged", async () => {
		await writeRepo(true);

		const { code, output } = runCLI("run pre-commit");

		expect(code, `CLI failed:\n${output}`).toBe(0);
		expect(output).toContain("Replaying scripts on unstaged changes");
		expect(output).toContain("pre-commit hook passed");

		// Index should reflect the formatter applied to the staged content.
		expect(readIndex()).toBe("STAGED\n");

		// Working tree should reflect the formatter applied to the unstaged content.
		expect(await readWorkingTree()).toBe("UNSTAGED\n");

		// No conflict markers anywhere.
		expect(await readWorkingTree()).not.toMatch(/<{7}|={7}|>{7}/);

		// The stash list should NOT have a leftover stash from this run.
		const stashList = execSync("git stash list", {
			cwd: testDir,
			encoding: "utf-8",
		});
		expect(stashList.trim()).toBe("");
	}, 60000);

	it("with replayFormatter=false (legacy): stash apply conflicts and CLI exits non-zero", async () => {
		await writeRepo(false);

		const { code, output } = runCLI("run pre-commit");

		// Legacy flow can't reconcile this: stash apply fails (with retry).
		expect(code).not.toBe(0);
		expect(output).toMatch(/stash apply failed|CRITICAL/i);
	}, 60000);
});
