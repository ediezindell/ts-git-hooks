import { promises as fs } from "node:fs";
import path from "node:path";
import { generateScriptTypes } from "../core/type-generator";
import { fileExists } from "../utils/fs";
import { logger } from "../utils/logger";

const configFileName = "git-hooks.config.ts";

// Updated content that imports the generated types
const defaultConfigContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';
import type { PackageScripts } from './git-hooks.d.ts';

// For type safety, you can use the 'PackageScripts' type:
// export const config: TSGitHookConfig<PackageScripts> = {
export const config: TSGitHookConfig = {
  // Run all hooks sequentially (default is parallel)
  // sequential: true,
  'pre-commit': {
    '*.{js,ts,jsx,tsx}': ['lint', 'test'],
    '*.{md,json}': 'format',
  },
  'pre-push': 'build',
};
`;

/**
 * Initializes the project by creating a config file and generating types.
 */
export async function init() {
	const configFilePath = path.join(process.cwd(), configFileName);

	if (await fileExists(configFilePath)) {
		logger.warn(`Configuration file "${configFileName}" already exists.`);
		return;
	}

	try {
		// Create the main config file
		await fs.writeFile(configFilePath, defaultConfigContent, "utf-8");
		logger.success(`Configuration file created at "${configFileName}"`);

		// Generate the types from package.json
		await generateScriptTypes();
	} catch (error) {
		logger.error("Failed to create configuration file:");
		logger.error(error);
		// In case of error, clean up the created config file
		if (await fileExists(configFilePath)) {
			await fs.unlink(configFilePath);
		}
	}
}
