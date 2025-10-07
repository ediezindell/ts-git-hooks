import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uninstall } from './uninstall';
import { loadConfig } from '../core/config';

// Mock dependencies
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn().mockResolvedValue(undefined), // Default to file existing
  },
}));
vi.mock('../core/config');

const gitHooksDir = path.join(process.cwd(), '.git', 'hooks');
const hookIdentifier = '# This hook was installed by ts-git-hooks';

describe('uninstall command', () => {
  beforeEach(() => {
    // Mock config to simulate which hooks are managed by us
    vi.mocked(loadConfig).mockResolvedValue({
      'pre-commit': { run: ['lint'] },
      'pre-push': { run: ['test'] },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should remove hook files managed by ts-git-hooks', async () => {
    // Arrange
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(hookIdentifier) // pre-commit is ours
      .mockResolvedValueOnce(hookIdentifier); // pre-push is ours

    // Act
    await uninstall();

    // Assert
    expect(fs.unlink).toHaveBeenCalledWith(path.join(gitHooksDir, 'pre-commit'));
    expect(fs.unlink).toHaveBeenCalledWith(path.join(gitHooksDir, 'pre-push'));
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it('should not remove hook files not managed by ts-git-hooks', async () => {
    // Arrange
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(hookIdentifier) // pre-commit is ours
      .mockResolvedValueOnce('some other content'); // pre-push is NOT ours

    // Act
    await uninstall();

    // Assert
    expect(fs.unlink).toHaveBeenCalledWith(path.join(gitHooksDir, 'pre-commit'));
    expect(fs.unlink).not.toHaveBeenCalledWith(path.join(gitHooksDir, 'pre-push'));
    expect(fs.unlink).toHaveBeenCalledOnce();
  });

  it('should log a success message', async () => {
    // Arrange
    vi.mocked(fs.readFile).mockResolvedValue(hookIdentifier);

    // Act
    await uninstall();

    // Assert
    expect(console.log).toHaveBeenCalledWith('ts-git-hooks uninstalled successfully.');
    expect(console.log).toHaveBeenCalledWith('  - Removed pre-commit');
    expect(console.log).toHaveBeenCalledWith('  - Removed pre-push');
  });

  it('should handle cases where hook files do not exist', async () => {
    // Arrange
    vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));

    // Act
    await uninstall();

    // Assert
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('No ts-git-hooks to uninstall.');
  });
});