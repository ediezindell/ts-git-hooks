import { spawn } from 'node:child_process';
import { loadConfig } from './config';
import type { GitHook } from '../types';
import { getStagedFiles } from '../utils/git';
import micromatch from 'micromatch';

/**
 * Executes a single npm script using `spawn`.
 * @param script The name of the npm script to run.
 */
function executeScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`> Running script: ${script}`);
    const child = spawn('npm', ['run', script], {
      stdio: 'inherit',
      shell: true, // Use shell for better cross-platform compatibility
    });

    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script "${script}" exited with code ${code}`));
      }
    });

    child.on('error', err => {
      reject(err);
    });
  });
}

/**
 * Runs the configured scripts for a given git hook.
 * @param hookName The name of the git hook being triggered.
 */
export async function runHook(hookName: GitHook) {
  const config = await loadConfig();

  if (!config) {
    console.error('Error: ts-git-hooks configuration file not found.');
    process.exit(1);
    return;
  }

  const hookConfig = config[hookName];

  if (!hookConfig || Object.keys(hookConfig).length === 0) {
    return; // No configuration for this hook
  }

  const scriptsToRun = new Set<string>();
  const { run, ...globConfigs } = hookConfig;

  // Handle unconditional scripts from 'run'
  if (run) {
    const scripts = Array.isArray(run) ? run : [run];
    scripts.forEach(script => scriptsToRun.add(script));
  }

  // Handle glob-based scripts
  const stagedFiles = await getStagedFiles();
  if (stagedFiles && stagedFiles.length > 0) {
    for (const [globPattern, scripts] of Object.entries(globConfigs)) {
      const matchingFiles = micromatch(stagedFiles, globPattern, {
        matchBase: true, // Allows patterns like *.js to match files in subdirectories
      });
      if (matchingFiles.length > 0) {
        const scriptsArray = Array.isArray(scripts) ? scripts : [scripts];
        scriptsArray.forEach(script => scriptsToRun.add(script));
      }
    }
  }

  const finalScripts = Array.from(scriptsToRun);

  if (finalScripts.length === 0) {
    console.log(`ts-git-hooks: No scripts to run for ${hookName}.`);
    return;
  }

  console.log(`ts-git-hooks: Running scripts for ${hookName}...`);

  try {
    const results = await Promise.allSettled(
      finalScripts.map(script => executeScript(script))
    );

    const failedScripts = results.filter(
      result => result.status === 'rejected'
    );

    if (failedScripts.length > 0) {
      console.error(
        `\nts-git-hooks: ${hookName} hook failed. At least one script failed.`
      );
      process.exit(1);
    } else {
      console.log(`\nts-git-hooks: ${hookName} hook passed.`);
    }
  } catch (error) {
    console.error(
      `\nts-git-hooks: An unexpected error occurred during the ${hookName} hook.`
    );
    process.exit(1);
  }
}