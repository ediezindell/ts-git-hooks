import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'node:child_process';
import {
  getStagedFiles,
  hasUnstagedChanges,
  stashPushKeepIndex,
  stashPop,
  getChangedFiles,
  addFiles,
} from './git';

// Mock the 'exec' function from 'node:child_process'
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Typecast the mocked exec to be able to use vi.mocked helper
const mockedExec = vi.mocked(exec);

describe('utils/git', () => {
  beforeEach(() => {
    // Clear mock history and implementations before each test
    mockedExec.mockClear();
  });

  // Test for getStagedFiles
  describe('getStagedFiles', () => {
    it('should return an array of staged files', async () => {
      const stdout = 'file1.ts\nfile2.js\nsrc/file3.css';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const files = await getStagedFiles();
      expect(mockedExec).toHaveBeenCalledWith('git diff --cached --name-only', expect.any(Function));
      expect(files).toEqual(['file1.ts', 'file2.js', 'src/file3.css']);
    });

    it('should return an empty array when no files are staged', async () => {
      const stdout = '';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const files = await getStagedFiles();
      expect(files).toEqual([]);
    });
  });

  // Test for hasUnstagedChanges
  describe('hasUnstagedChanges', () => {
    it('should return true for unstaged modifications', async () => {
      const stdout = ' M file1.ts';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const result = await hasUnstagedChanges();
      expect(mockedExec).toHaveBeenCalledWith('git status --porcelain', expect.any(Function));
      expect(result).toBe(true);
    });

    it('should return true for untracked files', async () => {
      const stdout = '?? file2.js';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const result = await hasUnstagedChanges();
      expect(result).toBe(true);
    });

    it('should return false when only staged changes exist', async () => {
      const stdout = 'A  file1.ts\nM  file2.js';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const result = await hasUnstagedChanges();
      expect(result).toBe(false);
    });

    it('should return false for a clean state', async () => {
      const stdout = '';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const result = await hasUnstagedChanges();
      expect(result).toBe(false);
    });
  });

  // Test for stashPushKeepIndex
  describe('stashPushKeepIndex', () => {
    it('should return true if a stash was created', async () => {
      const stdout = 'Saved working directory and index state WIP on master: ...';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const result = await stashPushKeepIndex();
      expect(mockedExec).toHaveBeenCalledWith('git stash push --keep-index --include-untracked', expect.any(Function));
      expect(result).toBe(true);
    });

    it('should return false if no stash was created', async () => {
      const stdout = 'No local changes to save';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const result = await stashPushKeepIndex();
      expect(result).toBe(false);
    });
  });

  // Test for stashPop
  describe('stashPop', () => {
    it('should resolve successfully when stash pop succeeds', async () => {
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, 'Dropped refs/stash@{0} (abc...)', '');
        return {} as any;
      });
      await expect(stashPop()).resolves.toBeUndefined();
      expect(mockedExec).toHaveBeenCalledWith('git stash pop', expect.any(Function));
    });

    it('should throw an error when stash pop fails', async () => {
      const error = new Error('Conflict');
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(error, '', 'error details');
        return {} as any;
      });
      await expect(stashPop()).rejects.toThrow('Conflict');
    });
  });

  // Test for getChangedFiles
  describe('getChangedFiles', () => {
    it('should return an array of changed file paths', async () => {
      const stdout = ' M modified.ts\nA  new-file.js\n?? untracked.txt\n D deleted.log';
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, stdout, '');
        return {} as any;
      });
      const files = await getChangedFiles();
      expect(mockedExec).toHaveBeenCalledWith('git status --porcelain', expect.any(Function));
      expect(files).toEqual(['modified.ts', 'new-file.js', 'untracked.txt']);
    });

    it('should return an empty array when there are no changes', async () => {
        mockedExec.mockImplementation((command, callback) => {
            if (callback) callback(null, '', '');
            return {} as any;
        });
        const files = await getChangedFiles();
        expect(files).toEqual([]);
    });
  });

  // Test for addFiles
  describe('addFiles', () => {
    it('should call git add with a list of files', async () => {
      const files = ['file1.ts', 'src/file2.js'];
      mockedExec.mockImplementation((command, callback) => {
        if (callback) callback(null, '', '');
        return {} as any;
      });
      await addFiles(files);
      expect(mockedExec).toHaveBeenCalledWith('git add "file1.ts" "src/file2.js"', expect.any(Function));
    });

    it('should not call exec if the files array is empty', async () => {
      await addFiles([]);
      expect(mockedExec).not.toHaveBeenCalled();
    });
  });
});