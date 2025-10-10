import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { install } from './install';
import { loadConfig } from '../core/config';

// Mock dependencies
vi.mock('node:fs', () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    chmod: vi.fn(),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }), // Default to .git being a directory
  },
}));
vi.mock('../core/config');

const gitHooksDir = path.join(process.cwd(), '.git', 'hooks');

describe('install command', () => {
  let errorSpy: vi.SpyInstance;

  beforeEach(() => {
    // Reset mocks before each test
    vi.mocked(loadConfig).mockResolvedValue({
      'pre-commit': { run: ['lint'] },
      'pre-push': { run: ['test'] },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Ensure stat mock is reset to a valid state before each test
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create .git/hooks directory', async () => {
    // Act
    await install();

    // Assert
    expect(fs.mkdir).toHaveBeenCalledWith(gitHooksDir, { recursive: true });
  });

  it('should create and write to hook files', async () => {
    // Act
    await install();

    // Assert
    const preCommitPath = path.join(gitHooksDir, 'pre-commit');
    const prePushPath = path.join(gitHooksDir, 'pre-push');
    const expectedContent = expect.stringContaining('#!/bin/sh');

    expect(fs.writeFile).toHaveBeenCalledWith(preCommitPath, expectedContent, 'utf-8');
    expect(fs.writeFile).toHaveBeenCalledWith(prePushPath, expectedContent, 'utf-8');
  });

  it('should make the hook files executable', async () => {
    // Act
    await install();

    // Assert
    const preCommitPath = path.join(gitHooksDir, 'pre-commit');
    const prePushPath = path.join(gitHooksDir, 'pre-push');

    expect(fs.chmod).toHaveBeenCalledWith(preCommitPath, 0o755);
    expect(fs.chmod).toHaveBeenCalledWith(prePushPath, 0o755);
  });

  it('should log installed hooks to the console', async () => {
    // Act
    await install();

    // Assert
    expect(console.log).toHaveBeenCalledWith('ts-git-hooks installed successfully.');
    expect(console.log).toHaveBeenCalledWith('  - pre-commit');
    expect(console.log).toHaveBeenCalledWith('  - pre-push');
  });

  it('should handle the case where no config is found', async () => {
    // Arrange
    vi.mocked(loadConfig).mockResolvedValue(null);

    // Act
    await install();

    // Assert
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Configuration file not found or is empty.'));
  });

  it('should show an error if .git directory is missing', async () => {
    // Arrange
    const error = new Error('Not found');
    (error as any).code = 'ENOENT';
    vi.mocked(fs.stat).mockRejectedValue(error);

    // Act
    await install();

    // Assert
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('This does not appear to be a git repository.')
    );
    expect(fs.mkdir).not.toHaveBeenCalled(); // Should not proceed with installation
  });

  it('should show an error if .git is a file, not a directory', async () => {
    // Arrange
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);

    // Act
    await install();

    // Assert
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('A .git file exists but it is not a directory.')
    );
    expect(fs.mkdir).not.toHaveBeenCalled(); // Should not proceed
  });
});