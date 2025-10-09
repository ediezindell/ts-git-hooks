#!/usr/bin/env node

import { init } from '../commands/init.js';
import { install } from '../commands/install.js';
import { uninstall } from '../commands/uninstall.js';
import { list } from '../commands/list.js';
import { runHook } from '../core/runner.js';
import type { GitHook } from '../types.js';

export async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case 'init':
      await init();
      break;

    case 'install':
      await install();
      break;

    case 'uninstall':
      await uninstall();
      break;

    case 'list':
      await list();
      break;

    case 'run':
      const hookName = args[0] as GitHook;
      if (!hookName) {
        console.error('Error: "run" command requires a hook name.');
        console.error('Example: ts-git-hooks run pre-commit');
        process.exit(1);
      }
      const success = await runHook(hookName);
      if (!success) {
        process.exit(1);
      }
      break;

    case undefined:
    case '--help':
    case '-h':
      console.log(`
Usage: ts-git-hooks <command>

Available commands:
  init        Create a default configuration file.
  install     Install git hooks based on the configuration.
  uninstall   Remove installed git hooks.
  list        List all configured hooks.
  run <hook>  Run the scripts for a specific hook (for internal use).
      `);
      break;

    default:
      console.error(`Error: Unknown command "${command}".`);
      console.log('Run "ts-git-hooks --help" for a list of available commands.');
      process.exit(1);
  }
}

// This check ensures that main() is called only when the script is executed directly
if (process.env.NODE_ENV !== 'test') {
    main().catch(error => {
        console.error('An unexpected error occurred:');
        console.error(error);
        process.exit(1);
    });
}