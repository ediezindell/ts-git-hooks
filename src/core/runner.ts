import { spawn } from 'node:child_process';
import { loadConfig } from './config';
import type { GitHook } from '../types';
import {
  getStagedFiles,
  hasUnstagedChanges,
  stashPushKeepIndex,
  stashPop,
  getChangedFiles,
  addFiles,
} from '../utils/git';
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
 * @returns A promise that resolves to `true` if the hook succeeds, `false` otherwise.
 */
export async function runHook(hookName: GitHook): Promise<boolean> {
  const config = await loadConfig();

  if (!config) {
    console.error('Error: ts-git-hooks configuration file not found.');
    return false;
  }

  const hookConfig = config[hookName];

  if (!hookConfig || Object.keys(hookConfig).length === 0) {
    return true; // No configuration for this hook, so it's a success
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
    return true;
  }

  let stashCreated = false;

  try {
    // 1. Stash unstaged changes if they exist
    if (await hasUnstagedChanges()) {
      console.log('ts-git-hooks: Stashing unstaged changes...');
      stashCreated = await stashPushKeepIndex();
    }

    // 2. Run the scripts
    console.log(`ts-git-hooks: Running scripts for ${hookName}...`);
    const results = await Promise.allSettled(
      finalScripts.map(script => executeScript(script))
    );

    const failedScripts = results.filter(
      result => result.status === 'rejected'
    );

    if (failedScripts.length > 0) {
      throw new Error(
        `\n${hookName} hook failed. At least one script failed.`
      );
    }

    // 3. For pre-commit, stage any changes made by the scripts
    if (hookName === 'pre-commit') {
      const changedFiles = await getChangedFiles();
      if (changedFiles.length > 0) {
        console.log(
          'ts-git-hooks: Adding modified files to the index...'
        );
        await addFiles(changedFiles);
      }
    }

    console.log(`\nts-git-hooks: ${hookName} hook passed.`);
    return true;
  } catch (error: any) {
    console.error(
      `\nts-git-hooks: An error occurred during the ${hookName} hook.`
    );
    if (error && error.message) {
      console.error(error.message);
    }
    return false;
  } finally {
    // 4. Pop the stash if one was created
    if (stashCreated) {
      try {
        console.log('ts-git-hooks: Restoring unstaged changes...');
        await stashPop();
      } catch (stashError) {
        console.error(
          `\nCRITICAL: Failed to restore unstaged changes. Please resolve conflicts manually.`
        );
        // This is a critical failure, we need to inform the user and exit
        process.exit(1);
      }
    }
  }
}