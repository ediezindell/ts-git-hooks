import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Since this is an ESM module, __dirname is not available. We can create a similar utility.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configFileName = 'ts-git-hooks.config.ts';

const defaultConfigContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';

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