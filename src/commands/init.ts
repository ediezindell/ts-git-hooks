import { promises as fs } from "node:fs";
import path from "node:path";

const configFileName = "git-hooks.config.ts";
const tsConfigForHooksFileName = "tsconfig.githooks.json";

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

const generateTsConfigForHooksContent = (extendsTsConfig: boolean): string => {
	const config: {
		extends?: string;
		compilerOptions: { resolveJsonModule: boolean; moduleResolution: string };
		include: string[];
	} = {
		compilerOptions: {
			resolveJsonModule: true,
			moduleResolution: "node",
		},
		include: [configFileName],
	};

	if (extendsTsConfig) {
		config.extends = "./tsconfig.json";
	}

	return JSON.stringify(config, null, 2);
};

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
 * Initializes the project by creating a `git-hooks.config.ts` file
 * and a corresponding `tsconfig.githooks.json` for IDE support.
 */
export async function init() {
	const configFilePath = path.join(process.cwd(), configFileName);
	const tsConfigForHooksPath = path.join(
		process.cwd(),
		tsConfigForHooksFileName,
	);
	const rootTsConfigPath = path.join(process.cwd(), "tsconfig.json");

	if (await fileExists(configFilePath)) {
		console.log(`Configuration file "${configFileName}" already exists.`);
		return;
	}

	try {
		// Create the main config file
		await fs.writeFile(configFilePath, defaultConfigContent, "utf-8");
		console.log(`Configuration file created at "${configFileName}"`);

		// Create the tsconfig for IDE support
		const rootTsConfigExists = await fileExists(rootTsConfigPath);
		const tsConfigContent = generateTsConfigForHooksContent(rootTsConfigExists);
		await fs.writeFile(tsConfigForHooksPath, tsConfigContent, "utf-8");
		console.log(`IDE-assist file created at "${tsConfigForHooksFileName}"`);
	} catch (error) {
		console.error("Failed to create configuration files:", error);
	}
}