import { describe, it, expect, vi, afterEach } from 'vitest';
import { getChangedFiles } from './git';
import { exec } from 'node:child_process';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

describe('getChangedFiles', () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

  it('should exclude files staged for deletion (D )', async () => {
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, callback) => {
        if (cmd.includes('git status --porcelain')) {
            callback(null, 'D  deleted-staged.txt\nM  modified.txt', '');
        }
    });

    const files = await getChangedFiles();
    expect(files).toEqual(['modified.txt']);
  });

  it('should exclude files deleted in work tree ( D)', async () => {
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, callback) => {
        if (cmd.includes('git status --porcelain')) {
            callback(null, ' D deleted-unstaged.txt\nM  modified.txt', '');
        }
    });
    const files = await getChangedFiles();
    expect(files).toEqual(['modified.txt']);
  });

  it('should include untracked files (??)', async () => {
     (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, callback) => {
        if (cmd.includes('git status --porcelain')) {
            callback(null, '?? untracked.txt', '');
        }
    });
    const files = await getChangedFiles();
    expect(files).toEqual(['untracked.txt']);
  });
});
