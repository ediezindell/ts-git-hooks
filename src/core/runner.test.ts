import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runHook } from './runner';
import { loadConfig } from './config';
import { getStagedFiles } from '../utils/git';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mock dependencies
vi.mock('./config');
vi.mock('../utils/git');
vi.mock('node:child_process');

// A mock ChildProcess to control its events
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('runHook', () => {
  let mockChild: MockChildProcess;
  let exitSpy: vi.SpyInstance;
  let errorSpy: vi.SpyInstance;

  beforeEach(() => {
    mockChild = new MockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockChild as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Replace spies to be more robust
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Provide a default mock for getStagedFiles to avoid breaking non-glob tests
    vi.mocked(getStagedFiles).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const simulateSuccess = (process: MockChildProcess) => {
    setTimeout(() => process.emit('close', 0), 0);
  };

  const simulateFailure = (process: MockChildProcess) => {
    setTimeout(() => process.emit('close', 1), 0);
  };

  it('should execute a single script for a given hook', async () => {
    vi.mocked(loadConfig).mockResolvedValue({ 'pre-commit': { run: 'lint' } });

    // The mock will be configured to succeed
    vi.mocked(spawn).mockImplementationOnce(() => {
      const p = new MockChildProcess();
      simulateSuccess(p);
      return p as any;
    });

    await runHook('pre-commit');

    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'lint'], expect.any(Object));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should execute multiple scripts in parallel for a given hook', async () => {
    vi.mocked(loadConfig).mockResolvedValue({ 'pre-commit': { run: ['lint', 'test'] } });

    vi.mocked(spawn).mockImplementation(() => {
      const p = new MockChildProcess();
      simulateSuccess(p);
      return p as any;
    });

    await runHook('pre-commit');

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'lint'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'test'], expect.any(Object));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should exit with a non-zero code if a script fails', async () => {
    vi.mocked(loadConfig).mockResolvedValue({ 'pre-commit': { run: ['lint', 'test'] } });

    vi.mocked(spawn).mockImplementationOnce(() => {
      const p = new MockChildProcess();
      simulateSuccess(p);
      return p as any;
    }).mockImplementationOnce(() => {
      const p = new MockChildProcess();
      simulateFailure(p);
      return p as any;
    });

    await runHook('pre-commit');

    // The stderr output proves the error was logged. A simple check is enough.
    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should do nothing if the hook is not in the config', async () => {
    vi.mocked(loadConfig).mockResolvedValue({ 'pre-commit': { run: 'lint' } });
    await runHook('pre-push');
    expect(spawn).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should handle missing configuration file', async () => {
    vi.mocked(loadConfig).mockResolvedValue(null);
    await runHook('pre-commit');
    expect(spawn).not.toHaveBeenCalled();
    // Use exact string match for precision
    expect(errorSpy).toHaveBeenCalledWith('Error: ts-git-hooks configuration file not found.');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('Glob-based script execution', () => {
  let exitSpy: vi.SpyInstance;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const simulateSuccess = (process: MockChildProcess) => {
    setTimeout(() => process.emit('close', 0), 0);
  };

  it('should execute scripts for matching glob patterns', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      'pre-commit': {
        '*.ts': 'tsc',
        '*.{js,jsx}': ['lint', 'prettier'],
      },
    });

    vi.mocked(getStagedFiles).mockResolvedValue(['src/index.ts', 'src/component.jsx']);

    vi.mocked(spawn).mockImplementation(() => {
      const p = new MockChildProcess();
      simulateSuccess(p);
      return p as any;
    });

    await runHook('pre-commit');

    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'tsc'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'lint'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'prettier'], expect.any(Object));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should not execute scripts for non-matching files', async () => {
    vi.mocked(loadConfig).mockResolvedValue({ 'pre-commit': { '*.ts': 'tsc' } });
    vi.mocked(getStagedFiles).mockResolvedValue(['README.md', 'package.json']);

    await runHook('pre-commit');

    expect(spawn).not.toHaveBeenCalled();
  });

  it('should handle both `run` and glob patterns together', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      'pre-commit': {
        run: 'test',
        '*.ts': 'tsc',
      },
    });

    vi.mocked(getStagedFiles).mockResolvedValue(['src/index.ts']);
    vi.mocked(spawn).mockImplementation(() => {
      const p = new MockChildProcess();
      simulateSuccess(p);
      return p as any;
    });

    await runHook('pre-commit');

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'test'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'tsc'], expect.any(Object));
  });
});