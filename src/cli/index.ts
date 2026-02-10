#!/usr/bin/env node

import { spawn } from "node:child_process";
import type { GitHook } from "../types.js";
import { toKebabCase } from "../utils/casing.js";
import { logger } from "../utils/logger.js";

/**
 * Self-respawn with --experimental-strip-types if not already present.
 * This allows native loading of .ts config files without jiti.
 */
function ensureRuntimeFlags() {
	const args = process.execArgv;
	const hasFlag = args.includes("--experimental-strip-types") || args.includes("--experimental-transform-types");

	if (!hasFlag) {
		const nodeVersion = process.versions.node.split(".").map(Number);
		if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 6)) {
			logger.error("ts-git-hooks requires Node.js v22.6.0 or higher for native TypeScript support.");
			process.exit(1);
		}

		const child = spawn(
			process.execPath,
			["--experimental-strip-types", ...process.execArgv, ...process.argv.slice(1)],
			{ stdio: "inherit" },
		);
		child.on("close", (code) => process.exit(code ?? 0));
		return true;
	}
	return false;
}

export async function main() {
	if (ensureRuntimeFlags()) return;

	const command = process.argv[2];
	const args = process.argv.slice(3);

	// Optimization: Lazy load command modules to improve CLI startup time.
	// This prevents loading unnecessary dependencies for commands that are not being executed.
	switch (command) {
		case "init": {
			const { init } = await import("../commands/init.js");
			await init();
			break;
		}

		case "install": {
			const { install } = await import("../commands/install.js");
			await install();
			break;
		}

		case "uninstall": {
			const { uninstall } = await import("../commands/uninstall.js");
			await uninstall();
			break;
		}

		case "list": {
			const { list } = await import("../commands/list.js");
			await list();
			break;
		}

		case "verify": {
			const hookName = args[0] as GitHook;
			if (!hookName) {
				logger.error('Error: "verify" command requires a hook name.');
				logger.log("Example: ts-git-hooks verify pre-commit");
				process.exit(1);
				return;
			}
			const { verify } = await import("../commands/verify.js");
			await verify(toKebabCase(hookName as GitHook));
			break;
		}

		case "sync": {
			const { sync } = await import("../commands/sync.js");
			await sync();
			break;
		}

		case "run": {
			const hookName = args[0] as GitHook;
			if (!hookName) {
				logger.error('Error: "run" command requires a hook name.');
				logger.log("Example: ts-git-hooks run pre-commit");
				process.exit(1);
				return;
			}
			const { runHook } = await import("../core/runner.js");
			const success = await runHook(toKebabCase(hookName as GitHook));
			if (!success) {
				process.exit(1);
				return;
			}
			break;
		}

		case undefined:
		case "--help":
		case "-h":
			logger.log(`
Usage: ts-git-hooks <command>

Available commands:
  init          Create a default configuration file and sync script types.
  sync          Update script type definitions from package.json.
  install       Install git hooks based on the configuration.
  uninstall     Remove installed git hooks.
  list          List all configured hooks.
  verify <hook> Verify the configuration for a hook and show commands to be run.
  run <hook>    Run the scripts for a specific hook (for internal use).
      `);
			break;

		default:
			logger.error(`Error: Unknown command "${command}".`);
			logger.log('Run "ts-git-hooks --help" for a list of available commands.');
			process.exit(1);
			return;
	}
}

// This check ensures that main() is called only when the script is executed directly
if (process.env.NODE_ENV !== "test") {
	main().catch((error) => {
		logger.error("An unexpected error occurred:");
		logger.error(error);
		process.exit(1);
	});
}
