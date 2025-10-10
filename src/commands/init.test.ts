import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { init } from './init';

// Mock the entire 'node:fs' module
vi.mock('node:fs', () => ({
  promises: {
    writeFile: vi.fn(),
    access: vi.fn(),
  },
}));

const defaultConfigContent = `\
import type { TSGitHookConfig } from 'ts-git-hooks';

/**
 * To enable type-safe git hooks and get autocompletion for your npm scripts,
 * follow these steps:
 *
 * 1. In your 'tsconfig.json', make sure 'resolveJsonModule' is set to true.
 *    {
 *      "compilerOptions": {
 *        "resolveJsonModule": true
 *      }
 *    }
 *
 * 2. Uncomment the following lines to import your package.json.
 *    // import pkg from './package.json';
 *    // type Scripts = keyof typeof pkg.scripts;
 *
 * 3. Add the 'Scripts' generic to the TSGitHookConfig type.
 *    // export const config: TSGitHookConfig<Scripts> = {
 */
export const config: TSGitHookConfig = {
  'pre-commit': {
    run: ['npm run lint'],
  },
  'pre-push': {
    run: [],
  },
};
`;

describe('init command', () => {
  let logSpy: vi.SpyInstance;

  beforeEach(() => {
    // Reset mocks and spies before each test
    vi.resetAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  it('should create a config file if one does not exist', async () => {
    // Arrange
    vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
    const expectedPath = path.join(process.cwd(), 'ts-git-hooks.config.ts');

    // Act
    await init();

    // Assert
    expect(fs.writeFile).toHaveBeenCalledOnce();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      defaultConfigContent,
      'utf-8'
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Configuration file created at ts-git-hooks.config.ts'
    );
  });

  it('should not create a config file if one already exists', async () => {
    // Arrange
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // Act
    await init();

    // Assert
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'Configuration file already exists.'
    );
  });
});