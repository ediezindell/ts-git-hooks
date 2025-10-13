import { promises as fs } from "node:fs";
import path from "node:path";

const configFileName = "ts-git-hooks.config.ts";

const defaultConfigContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';
import pkg from './package.json' with { type: 'json' };

// Note: "build" script is added to "pre-commit" by default.
// You can remove it if you don't want to run it on every commit.
export const config: TSGitHookConfig<keyof typeof pkg.scripts> = {
  'pre-commit': {
    '*.{js,ts,jsx,tsx}': ['lint', 'test'],
    '*.{md,json}': 'format',
  },
  'pre-push': 'build',
};
`;

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
 * Initializes the project by creating a `ts-git-hooks.config.ts` file.
 */
export async function init() {
	const configFilePath = path.join(process.cwd(), configFileName);

	if (await fileExists(configFilePath)) {
		console.log("Configuration file already exists.");
		return;
	}

	try {
		await fs.writeFile(configFilePath, defaultConfigContent, "utf-8");
		console.log(`Configuration file created at ${configFileName}`);
	} catch (error) {
		console.error("Failed to create configuration file:", error);
	}
}
