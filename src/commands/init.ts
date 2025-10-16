import { promises as fs } from "node:fs";
import path from "node:path";
import { generateScriptTypes } from "../core/type-generator";

const configFileName = "git-hooks.config.ts";

/**
 * Generates the content for the git-hooks.config.ts file dynamically.
 * @param availableScripts A list of available npm scripts.
 * @returns The content of the configuration file.
 */
function generateConfigFileContent(availableScripts: string[]): string {
	const scriptSet = new Set(availableScripts);
	const config: { [key: string]: any } = {};

	const preCommitTasks: string[] = [];
	if (scriptSet.has("lint")) preCommitTasks.push("lint");
	if (scriptSet.has("test")) preCommitTasks.push("test");

	if (preCommitTasks.length > 0) {
		config["pre-commit"] = {
			"*.{js,ts,jsx,tsx}": preCommitTasks,
		};
	}

	const prePushTasks: string[] = [];
	if (scriptSet.has("build")) prePushTasks.push("build");

	if (prePushTasks.length > 0) {
		config["pre-push"] = prePushTasks;
	}

	// A simple JSON.stringify for the object content, then format it.
	// This is not perfect, but much more robust than manual string concatenation.
	const configString = JSON.stringify(config, null, 2)
		.replace(/"/g, "'") // Use single quotes for style
		.replace(/'([^']+)':/g, "$1:"); // Remove quotes from keys

	const finalContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';
import type { PackageScripts } from './git-hooks.d.ts';

export const config: TSGitHookConfig<PackageScripts> = ${configString};
`;

	// Add comments for missing hooks
	let finalWithComments = finalContent;
	if (!config["pre-commit"]) {
		finalWithComments = finalWithComments.replace(
			"};",
			`  // 'pre-commit': {\n  //   '*.{js,ts,jsx,tsx}': [],\n  // },\n};`,
		);
	}
	if (!config["pre-push"]) {
		finalWithComments = finalWithComments.replace(
			"};",
			`  // 'pre-push': [],\n};`,
		);
	}

	return finalWithComments;
}

/**
 * Checks if a file exists.
 * @param filePath The path to the file.
 * @returns True if the file exists, false otherwise.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Initializes the project by creating a dynamic, type-safe config file.
 */
export async function init() {
	const configFilePath = path.join(process.cwd(), configFileName);

	if (await fileExists(configFilePath)) {
		console.log(`Configuration file "${configFileName}" already exists.`);
		return;
	}

	try {
		const availableScripts = await generateScriptTypes();
		const configFileContent = generateConfigFileContent(availableScripts);
		await fs.writeFile(configFilePath, configFileContent, "utf-8");
		console.log(`Configuration file created at "${configFileName}"`);
	} catch (error) {
		console.error(
			"Failed to initialize. Please check for a package.json in your directory.",
		);
		if (await fileExists(configFilePath)) {
			await fs.unlink(configFilePath);
		}
		process.exit(1);
	}
}