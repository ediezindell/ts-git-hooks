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
		lstat: vi.fn(),
		access: vi.fn().mockRejectedValue(new Error("File not found")), // Default to not found
	},
}));

function enoent(): NodeJS.ErrnoException {
	const e = new Error("ENOENT") as NodeJS.ErrnoException;
	e.code = "ENOENT";
	return e;
}
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
		// Default: no pre-existing hook files at hookPath
		vi.mocked(fs.lstat).mockRejectedValue(enoent());
		// Default: registry file does not exist (fresh install); package.json reads ok
		const pkg = { scripts: { lint: "eslint .", test: "vitest" } };
		vi.mocked(fs.readFile).mockImplementation(async (p) => {
			const s = String(p);
			if (s.endsWith(".ts-git-hooks-installed.json")) throw enoent();
			return JSON.stringify(pkg);
		});
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

	it("should populate the registry with only the hooks present in config (triangulation)", async () => {
		// Arrange: only pre-commit configured
		vi.mocked(loadConfig).mockResolvedValueOnce({
			"pre-commit": { run: ["lint"] },
		});

		// Act
		await install();

		// Assert
		const registryWrite = vi.mocked(fs.writeFile).mock.calls.find((c) => {
			try {
				const parsed = JSON.parse(String(c[1]));
				return parsed && Array.isArray(parsed.hooks);
			} catch {
				return false;
			}
		});
		const hooks = JSON.parse(String(registryWrite?.[1])).hooks;
		expect(hooks).toEqual(["pre-commit"]);
	});

	it("should write a registry file listing the installed hook names", async () => {
		// Act
		await install();

		// Assert: somewhere among the writeFile calls is a JSON payload with a
		// "hooks" array containing the installed hook names. The exact path may
		// be a tmp path (atomic write); content is what matters here.
		const registryWrite = vi.mocked(fs.writeFile).mock.calls.find((c) => {
			try {
				const parsed = JSON.parse(String(c[1]));
				return parsed && Array.isArray(parsed.hooks);
			} catch {
				return false;
			}
		});
		expect(registryWrite, "registry writeFile not called").toBeTruthy();
		const hooks = JSON.parse(String(registryWrite?.[1])).hooks;
		expect(hooks).toContain("pre-commit");
		expect(hooks).toContain("pre-push");
	});

	it("should back up a pre-existing unmanaged hook file before installing", async () => {
		// Arrange: hookPath exists, registry says no managed hooks
		vi.mocked(fs.lstat).mockResolvedValue({
			isSymbolicLink: () => false,
			isFile: () => true,
		} as any);

		// Act
		await install();

		// Assert: a rename moved the existing file into a backup dir
		// (rename src = original hookPath, dest starts with backup dir)
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const backupRenames = vi
			.mocked(fs.rename)
			.mock.calls.filter(
				(c) =>
					String(c[0]) === preCommitPath &&
					String(c[1]).includes(".ts-git-hooks-backups"),
			);
		expect(backupRenames.length).toBe(1);
	});

	it("should not back up when the pre-existing hook is managed (in registry)", async () => {
		// Arrange: hookPath exists; registry already has pre-commit / pre-push as managed
		vi.mocked(fs.lstat).mockResolvedValue({
			isSymbolicLink: () => false,
			isFile: () => true,
		} as any);
		vi.mocked(fs.readFile).mockImplementation(async (p) => {
			const s = String(p);
			if (s.endsWith(".ts-git-hooks-installed.json")) {
				return JSON.stringify({ hooks: ["pre-commit", "pre-push"] });
			}
			return JSON.stringify({ scripts: { lint: "eslint .", test: "vitest" } });
		});

		// Act
		await install();

		// Assert: no rename into a backup dir
		const backupRenames = vi
			.mocked(fs.rename)
			.mock.calls.filter((c) => String(c[1]).includes(".ts-git-hooks-backups"));
		expect(backupRenames.length).toBe(0);
	});

	it("should not back up when no pre-existing hook file is present", async () => {
		// Arrange: default beforeEach has lstat → ENOENT
		// Act
		await install();
		// Assert
		const backupRenames = vi
			.mocked(fs.rename)
			.mock.calls.filter((c) => String(c[1]).includes(".ts-git-hooks-backups"));
		expect(backupRenames.length).toBe(0);
	});

	it("should back up a pre-existing symlink at hookPath (preserves the symlink)", async () => {
		// Arrange: hookPath is a symlink
		vi.mocked(fs.lstat).mockResolvedValue({
			isSymbolicLink: () => true,
			isFile: () => false,
		} as any);

		// Act
		await install();

		// Assert: rename moves the symlink to backup (rename preserves type)
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		const backupRenames = vi
			.mocked(fs.rename)
			.mock.calls.filter(
				(c) =>
					String(c[0]) === preCommitPath &&
					String(c[1]).includes(".ts-git-hooks-backups"),
			);
		expect(backupRenames.length).toBe(1);
	});

	it("should create the backup dir with mode 0o700", async () => {
		// Arrange: hookPath exists so a backup is taken
		vi.mocked(fs.lstat).mockResolvedValue({
			isSymbolicLink: () => false,
			isFile: () => true,
		} as any);

		// Act
		await install();

		// Assert: an mkdir for a backups path was made with mode 0o700
		const backupMkdirs = vi.mocked(fs.mkdir).mock.calls.filter((c) => {
			const p = String(c[0]);
			const opts = c[1] as { mode?: number } | undefined;
			return p.includes(".ts-git-hooks-backups") && opts?.mode === 0o700;
		});
		expect(backupMkdirs.length).toBeGreaterThan(0);
	});

	it("should log a warning containing the backup path when displacing an existing hook", async () => {
		// Arrange
		vi.mocked(fs.lstat).mockResolvedValue({
			isSymbolicLink: () => false,
			isFile: () => true,
		} as any);

		// Act
		await install();

		// Assert: logger.warn (routed through console.log) mentions a backup path
		const warns = vi
			.mocked(console.log)
			.mock.calls.map((c) => c.join(" "))
			.filter((s) => s.includes(".ts-git-hooks-backups"));
		expect(warns.length).toBeGreaterThan(0);
	});

	it("should update the registry atomically (writeFile to tmp, rename to final)", async () => {
		// Act
		await install();

		// Assert: there is a rename whose dest ends with the registry filename
		const renameDests = vi
			.mocked(fs.rename)
			.mock.calls.map((c) => String(c[1]));
		expect(
			renameDests.some((p) => p.endsWith(".ts-git-hooks-installed.json")),
		).toBe(true);
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

	it("should still write hook files for normal hooks when global options are present", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			sequential: true,
			replayFormatter: true,
			preCommit: "lint",
		} as any);

		// Act
		await install();

		// Assert: exactly 1 hook is rename-installed (sequential / replay-formatter
		// are global options and must not produce hook files). Atomic write places
		// content via writeFile(tmp) → rename(tmp, hookPath), so count rename calls
		// whose dest is a hook path under gitHooksDir (excluding the .tmp / registry).
		const preCommitPath = path.join(gitHooksDir, "pre-commit");
		expect(getInstalledContent(preCommitPath)).toContain(
			"ts-git-hooks run pre-commit",
		);
		const hookRenames = vi.mocked(fs.rename).mock.calls.filter((c) => {
			const dest = String(c[1]);
			return (
				dest.startsWith(`${gitHooksDir}/`) &&
				!dest.endsWith(".tmp") &&
				!dest.endsWith(".json")
			);
		});
		expect(hookRenames).toHaveLength(1);
	});

	it("should not write a hook file for the global option 'replayFormatter'", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			replayFormatter: true,
			preCommit: "lint",
		} as any);

		// Act
		await install();

		// Assert
		const replayFormatterPath = path.join(gitHooksDir, "replay-formatter");
		expect(fs.writeFile).not.toHaveBeenCalledWith(
			replayFormatterPath,
			expect.anything(),
			expect.anything(),
		);
	});

	it("should not write a hook file for the global option 'sequential'", async () => {
		// Arrange
		vi.mocked(loadConfig).mockResolvedValue({
			sequential: true,
			preCommit: "lint",
		} as any);

		// Act
		await install();

		// Assert
		const sequentialPath = path.join(gitHooksDir, "sequential");
		expect(fs.writeFile).not.toHaveBeenCalledWith(
			sequentialPath,
			expect.anything(),
			expect.anything(),
		);
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
