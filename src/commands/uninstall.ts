import { promises as fs } from "node:fs";
import path from "node:path";
import { fileExists } from "../utils/fs";
import { getGitHooksDir } from "../utils/git";
import { logger } from "../utils/logger";

const REGISTRY_FILENAME = ".ts-git-hooks-installed.json";

async function readRegistryHooks(gitHooksDir: string): Promise<string[] | null> {
	const registryPath = path.join(gitHooksDir, REGISTRY_FILENAME);
	try {
		const content = await fs.readFile(registryPath, "utf-8");
		const parsed = JSON.parse(content);
		return Array.isArray(parsed.hooks)
			? parsed.hooks.filter((h: unknown) => typeof h === "string")
			: [];
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/**
 * Uninstalls git hooks managed by ts-git-hooks. Source of truth is the on-disk
 * registry written by install — files not listed there are never removed,
 * which defends against marker-substring spoofing.
 */
export async function uninstall() {
	const gitHooksDir = await getGitHooksDir();
	const registryHooks = await readRegistryHooks(gitHooksDir);

	if (registryHooks === null) {
		logger.info("No ts-git-hooks to uninstall.");
		return;
	}

	const removed: string[] = [];
	for (const hookName of registryHooks) {
		// Re-validate names from the on-disk registry to refuse path traversal
		// even if the file is tampered with.
		if (!/^[a-z0-9-]+$/.test(hookName)) continue;

		const hookPath = path.join(gitHooksDir, hookName);
		if (!(await fileExists(hookPath))) continue;

		try {
			await fs.unlink(hookPath);
			removed.push(hookName);
		} catch (_error) {
			// Best-effort: the file may have vanished between fileExists and unlink.
		}
	}

	// Registry file is bookkeeping; drop it once we've processed it so a stale
	// list does not linger after uninstall.
	await fs
		.unlink(path.join(gitHooksDir, REGISTRY_FILENAME))
		.catch(() => {});

	if (removed.length > 0) {
		logger.success("ts-git-hooks uninstalled successfully.");
		for (const hookName of removed) {
			logger.log(`  - Removed ${hookName}`);
		}
	} else {
		logger.info("No ts-git-hooks to uninstall.");
	}
}
