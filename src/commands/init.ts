import { promises as fs } from 'node:fs';
import path from 'node:path';

const configFileName = 'ts-git-hooks.config.ts';

const defaultConfigContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';

/**
 * @see https://github.com/ediezindell/ts-git-hooks#type-safety
 *
 * To get full type-safety, you can pass your package.json scripts as a generic.
 *
 * @example
 * import pkg from './package.json'; // Make sure resolveJsonModule is true in tsconfig
 * type Scripts = keyof typeof pkg.scripts;
 * export const config: TSGitHookConfig<Scripts> = { ... };
 */
export const config: TSGitHookConfig = {
  'pre-commit': {
    run: ['npm test'],
  },
  'pre-push': {
    run: [],
  },
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
    console.log('Configuration file already exists.');
    return;
  }

  try {
    await fs.writeFile(configFilePath, defaultConfigContent, 'utf-8');
    console.log(`Configuration file created at ${configFileName}`);
  } catch (error) {
    console.error('Failed to create configuration file:', error);
  }
}