import { loadConfig } from '../core/config';
import type { GitHook } from '../types';

/**
 * Lists all the configured git hooks and their scripts.
 */
export async function list() {
  const config = await loadConfig();

  if (!config) {
    console.log('Configuration file not found.');
    return;
  }

  const configuredHooks = Object.keys(config) as GitHook[];

  if (configuredHooks.length === 0) {
    console.log('No hooks configured.');
    return;
  }

  console.log('Configured git hooks:');
  for (const hookName of configuredHooks) {
    const hookConfig = config[hookName];
    if (hookConfig) {
      const scripts = Array.isArray(hookConfig.run)
        ? hookConfig.run.join(', ')
        : hookConfig.run;
      console.log(`  - ${hookName}: ${scripts}`);
    }
  }
}