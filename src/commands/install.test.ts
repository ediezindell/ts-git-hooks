import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { getGitHooksDir } from "../utils/git";
import { getPackageManager } from "../utils/packageManager";
import { getDistCliPath, install } from "./install";

// Mock dependencies
vi.mock("node:fs", () => ({
	promises: {
		mkdir: vi.fn(),
		writeFile: vi.fn(),
		chmod: vi.fn(),
		rename: vi.fn(),
		unlink: vi.fn(),
		readFile: vi.fn(),
		access: vi.fn().mockRejectedValue(new Error("File not found")), // Default to not found
	},
}));
vi.mock("../core/config");
vi.mock("../utils/packageManager");
vi.mock("../utils/git", () => ({
	getGitHooksDir: vi.fn(),
}));

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");

/**
 * Atomic install writes content to a per-hook tmp file then renames to the final
 * hookPath. This helper resolves the content that ends up at `finalPath` by
 * looking up the corresponding rename source and the writeFile call against it.
 */
function getInstalledContent(finalPath: string): string {
	const renameCall = vi
		.mocked(fs.rename)
		.mock.calls.find((c) => String(c[1]) === finalPath);
	expect(renameCall, `rename to ${finalPath} not called`).toBeTruthy();
	const tmpPath = String(renameCall?.[0]);
	const writeCall = vi
		.mocked(fs.writeFile)
		.mock.calls.find((c) => String(c[0]) === tmpPath);
	expect(writeCall, `writeFile to ${tmpPath} not called`).toBeTruthy();
	return String(writeCall?.[1]);
}

describe("install command", () => {
	beforeEach(() => {
		// Reset mocks before each test
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { run: ["lint"] },
			"pre-push": { run: ["test"] },
		});
		vi.mocked(getPackageManager).mockReturnValue("npm");
		vi.mocked(getGitHooksDir).mockResolvedValue(gitHooksDir);
		const pkg = { scripts: { lint: "eslint .", test: "vitest" } };
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should create .git/hooks directory if it does not exist", async () => {
		// Arrange
		vi.mocked(fs.access).mockRejectedValueOnce(new Error("Dir not found")); // For .git/hooks

		// Act
		await install();

		// Assert
		expect(fs.mkdir).toHaveBeenCalledWith(gitHooksDir, { recursive: true });
	});

	it("should unlink the temp file when rename fails (best-effort cleanup)", async () => {
		// Arrange: rename always fails
		vi.mocked(fs.rename).mockRejectedValue(new Error("rename failed"));

		// Act
		await install();

		// Assert: each tmp file that was writeFile'd is unlinked, so no
		// abandoned .tmp files are left behind in .git/hooks/.
		const writtenTmps = vi
			.mocked(fs.writeFile)
			.mock.calls.map((c) => String(c[0]));
		const unlinked = vi.mocked(fs.unlink).mock.calls.map((c) => String(c[0]));
		expect(writtenTmps.length).toBeGreaterThan(0);
		for (const tmp of writtenTmps) {
			expect(unlinked).toContain(tmp);
		}
	});

	it("should fail closed when git rev-parse cannot resolve the hooks dir", async () => {
		// Arrange: simulate `git rev-parse` failure (not inside a git repo)
		vi.mocked(getGitHooksDir).mockRejectedValueOnce(
			new Error("fatal: not a git repository"),
		);

		// Act
		await install();

		// Assert: no hook script is written, error is logged
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(fs.rename).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to install git hooks:"),
		);
	});

	it("should write atomically: rename a temp file to the final hook path", async () => {
		// Act
		await install();

		// Assert: the final hookPath is set up via rename(<tmp>, hookPath),
		// not via a direct writeFile(hookPath, ...). This defeats symlink-follow
		// and closes the TOCTOU window between writeFile and chmod.
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const renameDests = vi
			.mocked(fs.rename)
			.mock.calls.map((c) => String(c[1]));
		expect(renameDests).toContain(preCommitPath);
	});

	it("should write hook files under the path returned by getGitHooksDir (worktree-aware)", async () => {
		// Arrange: simulate a linked worktree whose hooks dir lives outside cwd
		const worktreeHooksDir = "/abs/path/.git/worktrees/foo/hooks";
		vi.mocked(getGitHooksDir).mockResolvedValueOnce(worktreeHooksDir);

		// Act
		await install();

		// Assert: a file is written/renamed to a path under the resolved hooks dir,
		// not under process.cwd()/.git/hooks
		const calls = [
			...vi.mocked(fs.writeFile).mock.calls.map((c) => String(c[0])),
			...vi.mocked(fs.rename).mock.calls.map((c) => String(c[1])),
		];
		expect(calls.some((p) => p.startsWith(`${worktreeHooksDir}/`))).toBe(true);
		expect(calls.some((p) => p.startsWith(`${gitHooksDir}/`))).toBe(false);
	});

	it("should write hook files with optimized script when package manager is npm", async () => {
		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const expectedContent = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec npm exec ts-git-hooks run pre-commit
fi`;

		expect(getInstalledContent(preCommitPath)).toContain(expectedContent);
	});

	it("should write hook files with optimized script when package manager is yarn", async () => {
		// Arrange
		vi.mocked(getPackageManager).mockReturnValue("yarn");

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");

		const expectedContentPreCommit = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec yarn ts-git-hooks run pre-commit
fi`;

		const expectedContentPrePush = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-push
else
  exec yarn ts-git-hooks run pre-push
fi`;

		expect(getInstalledContent(preCommitPath)).toContain(
			expectedContentPreCommit,
		);
		expect(getInstalledContent(prePushPath)).toContain(expectedContentPrePush);
	});

	it("should write hook files with optimized script when package manager is pnpm", async () => {
		// Arrange
		vi.mocked(getPackageManager).mockReturnValue("pnpm");

		// Act
		await install();

		// Assert
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");

		const expectedContentPreCommit = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec pnpm ts-git-hooks run pre-commit
fi`;

		const expectedContentPrePush = `if [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-push
else
  exec pnpm ts-git-hooks run pre-push
fi`;

		expect(getInstalledContent(preCommitPath)).toContain(
			expectedContentPreCommit,
		);
		expect(getInstalledContent(prePushPath)).toContain(expectedContentPrePush);
	});

	it("should make the hook files executable", async () => {
		// Act
		await install();

		// Assert: chmod 0o755 is applied to the tmp path (before rename) so the
		// final hookPath is already executable when it appears.
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const prePushPath = path.join(gitHooksDir, "pre-push");
		const chmodCalls = vi.mocked(fs.chmod).mock.calls;
		const renameSrc = (finalPath: string) =>
			String(
				vi
					.mocked(fs.rename)
					.mock.calls.find((c) => String(c[1]) === finalPath)?.[0],
			);
		expect(chmodCalls).toContainEqual([renameSrc(preCommitPath), 0o755]);
		expect(chmodCalls).toContainEqual([renameSrc(prePushPath), 0o755]);
	});

	it("should log installed hooks to the console", async () => {
		// Act
		await install();

		// Assert
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("ts-git-hooks installed successfully."),
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("  - pre-commit"),
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("  - pre-push"),
		);
	});

	it("should handle the case where no config is found", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue(null);

		// Act
		await install();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("Configuration file not found or is empty."),
		);
	});

	it("should log an error if package manager detection fails", async () => {
		// Arrange
		const errorMessage = "Could not determine package manager.";
		vi.mocked(getPackageManager).mockImplementation(() => {
			throw new Error(errorMessage);
		});

		// Act
		await install();

		// Assert
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to install git hooks:"),
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(errorMessage),
		);
	});

	it("should skip invalid hook names for security", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit; touch exploited": { run: ["lint"] },
		} as any);

		// Act
		await install();

		// Assert
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	it("should write the optimized direct-node branch when getDistCliPath resolves", async () => {
		const originalArgv1 = process.argv[1];
		process.argv[1] = "/abs/path/to/node_modules/ts-git-hooks/dist/cli.js";
		try {
			await install();

			const preCommitPath = path.join(gitHooksDir, "pre-commit");
			const expectedOptimized = `if [ -f /abs/path/to/node_modules/ts-git-hooks/dist/cli.js ]; then
  exec node --experimental-strip-types /abs/path/to/node_modules/ts-git-hooks/dist/cli.js run pre-commit
elif [ -x "./node_modules/.bin/ts-git-hooks" ]; then
  exec ./node_modules/.bin/ts-git-hooks run pre-commit
else
  exec npm exec ts-git-hooks run pre-commit
fi`;

			expect(getInstalledContent(preCommitPath)).toContain(expectedOptimized);
		} finally {
			process.argv[1] = originalArgv1;
		}
	});

	it("should shell-quote cliPath that contains spaces or single quotes", async () => {
		const originalArgv1 = process.argv[1];
		process.argv[1] = "/Users/o'brien/My Projects/dist/cli.js";
		try {
			await install();

			// shell-quote chooses double quotes when the value contains a single quote;
			// the path is preserved verbatim inside the quotes.
			const quoted = `"/Users/o'brien/My Projects/dist/cli.js"`;
			const preCommitPath = path.join(gitHooksDir, "pre-commit");
			const content = getInstalledContent(preCommitPath);

			expect(content).toContain(`if [ -f ${quoted} ]`);
			expect(content).toContain(
				`exec node --experimental-strip-types ${quoted} run pre-commit`,
			);
		} finally {
			process.argv[1] = originalArgv1;
		}
	});
});

describe("getDistCliPath", () => {
	const originalArgv1 = process.argv[1];

	afterEach(() => {
		process.argv[1] = originalArgv1;
	});

	it("returns the entry path when it ends with cli.js", () => {
		process.argv[1] = "/abs/path/dist/cli.js";
		expect(getDistCliPath()).toBe("/abs/path/dist/cli.js");
	});

	it("returns null when entry does not end with cli.js (e.g. test runner)", () => {
		process.argv[1] = "/abs/path/node_modules/vitest/dist/runner.mjs";
		expect(getDistCliPath()).toBeNull();
	});

	it("returns null when process.argv[1] is empty", () => {
		process.argv[1] = "";
		expect(getDistCliPath()).toBeNull();
	});
});
