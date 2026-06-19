import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../core/config";
import { getGitHooksDir } from "../utils/git";
import { uninstall } from "./uninstall";

// Mock dependencies
vi.mock("node:fs", () => ({
	promises: {
		readFile: vi.fn(),
		unlink: vi.fn().mockResolvedValue(undefined),
		access: vi.fn().mockResolvedValue(undefined), // Default to file existing
	},
}));
vi.mock("../core/config");
vi.mock("../utils/git", () => ({
	getGitHooksDir: vi.fn(),
}));

const gitHooksDir = path.join(process.cwd(), ".git", "hooks");
const registryPath = path.join(gitHooksDir, ".ts-git-hooks-installed.json");
const hookIdentifier = "# This hook was installed by ts-git-hooks";

function enoent(): NodeJS.ErrnoException {
	const e = new Error("ENOENT") as NodeJS.ErrnoException;
	e.code = "ENOENT";
	return e;
}

describe("uninstall command", () => {
	beforeEach(() => {
		// Mock config to simulate which hooks are managed by us
		vi.mocked(loadConfig).mockResolvedValue({
			"pre-commit": { run: ["lint"] },
			"pre-push": { run: ["test"] },
		});
		vi.mocked(getGitHooksDir).mockResolvedValue(gitHooksDir);
		vi.mocked(fs.unlink).mockResolvedValue(undefined as never);
		vi.mocked(fs.access).mockResolvedValue(undefined);
		// Default: registry contains both hooks
		vi.mocked(fs.readFile).mockImplementation(async (p) => {
			if (String(p) === registryPath) {
				return JSON.stringify({ hooks: ["pre-commit", "pre-push"] });
			}
			return hookIdentifier;
		});
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "info").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should remove only the hooks listed in the registry", async () => {
		// Act
		await uninstall();

		// Assert
		expect(fs.unlink).toHaveBeenCalledWith(
			path.join(gitHooksDir, "pre-commit"),
		);
		expect(fs.unlink).toHaveBeenCalledWith(path.join(gitHooksDir, "pre-push"));
		// 2 hook unlinks + 1 registry file cleanup
		expect(fs.unlink).toHaveBeenCalledTimes(3);
	});

	it("should NOT unlink a hook whose content has the marker but is not in the registry (spoof defense)", async () => {
		// Arrange: registry only has pre-commit; pre-push exists on disk with our
		// marker substring but was NOT installed by us.
		vi.mocked(fs.readFile).mockImplementation(async (p) => {
			if (String(p) === registryPath) {
				return JSON.stringify({ hooks: ["pre-commit"] });
			}
			return hookIdentifier;
		});

		// Act
		await uninstall();

		// Assert
		expect(fs.unlink).toHaveBeenCalledWith(
			path.join(gitHooksDir, "pre-commit"),
		);
		expect(fs.unlink).not.toHaveBeenCalledWith(
			path.join(gitHooksDir, "pre-push"),
		);
	});

	it("should do nothing when the registry file does not exist", async () => {
		// Arrange: registry absent
		vi.mocked(fs.readFile).mockImplementation(async (p) => {
			if (String(p) === registryPath) throw enoent();
			return hookIdentifier;
		});

		// Act
		await uninstall();

		// Assert
		expect(fs.unlink).not.toHaveBeenCalled();
	});

	it("should silently skip a registry-listed hook when the file no longer exists", async () => {
		// Arrange: registry says pre-commit + pre-push, but only pre-commit exists
		vi.mocked(fs.access).mockImplementation(async (p) => {
			if (String(p) === path.join(gitHooksDir, "pre-push")) {
				throw enoent();
			}
		});

		// Act
		await uninstall();

		// Assert
		expect(fs.unlink).toHaveBeenCalledWith(
			path.join(gitHooksDir, "pre-commit"),
		);
		expect(fs.unlink).not.toHaveBeenCalledWith(
			path.join(gitHooksDir, "pre-push"),
		);
	});

	it("should remove the registry file after uninstalling all hooks", async () => {
		// Act
		await uninstall();

		// Assert
		expect(fs.unlink).toHaveBeenCalledWith(registryPath);
	});

	it("should refuse to unlink registry entries whose names fail the hook-name regex (traversal defense)", async () => {
		// Arrange: tampered registry contains a traversal payload
		vi.mocked(fs.readFile).mockImplementation(async (p) => {
			if (String(p) === registryPath) {
				return JSON.stringify({ hooks: ["../../etc/passwd", "pre-commit"] });
			}
			return hookIdentifier;
		});

		// Act
		await uninstall();

		// Assert: only the valid name was unlinked; the traversal one was rejected
		const unlinkArgs = vi.mocked(fs.unlink).mock.calls.map((c) => String(c[0]));
		expect(unlinkArgs).toContain(path.join(gitHooksDir, "pre-commit"));
		expect(
			unlinkArgs.some((a) => a.includes("../../etc/passwd")),
		).toBe(false);
	});
});
