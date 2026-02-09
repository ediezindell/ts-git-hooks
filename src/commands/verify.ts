import { isHookConfigWithOpts, loadConfig } from "../core/config";
import { resolveScriptsToRun } from "../core/runner";
import type { CamelCaseGitHook, HookConfig, KebabCaseGitHook } from "../types";
import { getGitStatus } from "../utils/git";
import { logger } from "../utils/logger";
import { kebabToCamel } from "../utils/string";

/**
 * Verifies the configuration for a given hook and prints the commands that would be executed.
 * @param hookName The name of the git hook to verify.
 */
export async function verify(hookName: KebabCaseGitHook) {
	const config = await loadConfig();

	if (!config) {
		logger.error("Configuration file not found.");
		return;
	}

	const camelHookName = kebabToCamel(hookName) as CamelCaseGitHook;
	const rawHookConfig = config[camelHookName];

	if (!rawHookConfig) {
		logger.info(`No configuration found for hook: ${hookName}`);
		return;
	}

	let hookConfig: HookConfig;
	let isSequential = config.sequential ?? false;

	if (isHookConfigWithOpts(rawHookConfig)) {
		hookConfig = rawHookConfig.config;
		if (rawHookConfig.sequential !== undefined) {
			isSequential = rawHookConfig.sequential;
		}
	} else {
		hookConfig = rawHookConfig as HookConfig;
	}

	// For verification, we fetch staged files to see what would actually match.
	const { stagedFiles } = await getGitStatus();

	const { scripts, matchedFiles } = await resolveScriptsToRun(
		hookConfig,
		stagedFiles,
	);

	logger.info(`Verification for hook: ${hookName}`);
	logger.info(`Execution mode: ${isSequential ? "sequential" : "parallel"}`);

	if (stagedFiles.length > 0) {
		logger.info(`Staged files (${stagedFiles.length}):`);
		for (const file of stagedFiles.slice(0, 10)) {
			logger.log(`  - ${file}`);
		}
		if (stagedFiles.length > 10) {
			logger.log(`  ... and ${stagedFiles.length - 10} more`);
		}
	} else {
		logger.info("No files are currently staged.");
	}

	if (matchedFiles && matchedFiles.length > 0) {
		logger.info(`Matched files (${matchedFiles.length}):`);
		for (const file of matchedFiles.slice(0, 10)) {
			logger.log(`  - ${file}`);
		}
		if (matchedFiles.length > 10) {
			logger.log(`  ... and ${matchedFiles.length - 10} more`);
		}
	}

	if (scripts.length === 0) {
		logger.warn("No scripts would be executed.");
		return;
	}

	logger.info("Commands to be executed:");
	for (const script of scripts) {
		if (typeof script === "string") {
			logger.log(`  - ${script}`);
		} else {
			const args = script.args.length > 0 ? ` ${script.args.join(" ")}` : "";
			logger.log(`  - ${script.script}${args}`);
		}
	}
}
