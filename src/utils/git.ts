import { exec } from 'node:child_process';

/**
 * Retrieves the list of staged files from git.
 * @returns A promise that resolves to an array of staged file paths.
 */
export function getStagedFiles(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    exec('git diff --cached --name-only', (error, stdout, stderr) => {
      if (error) {
        console.error('Error getting staged files:', stderr);
        reject(error);
        return;
      }
      const files = stdout.trim().split('\n').filter(Boolean);
      resolve(files);
    });
  });
}