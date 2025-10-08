import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the command modules. These mocks will be used by the dynamic import.
const mockInit = vi.fn();
const mockInstall = vi.fn();
const mockUninstall = vi.fn();
const mockList = vi.fn();
const mockRunHook = vi.fn();

vi.mock('../commands/init.js', () => ({ init: mockInit }));
vi.mock('../commands/install.js', () => ({ install: mockInstall }));
vi.mock('../commands/uninstall.js', () => ({ uninstall: mockUninstall }));
vi.mock('../commands/list.js', () => ({ list: mockList }));
vi.mock('../core/runner.js', () => ({ runHook: mockRunHook }));

describe('CLI entry point', () => {
  let logSpy: vi.SpyInstance;
  let errorSpy: vi.SpyInstance;
  let exitSpy: vi.SpyInstance;

  beforeEach(() => {
    vi.resetAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getCliMain = async () => (await import('./index.js')).main;

  it('should call the init command', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'init']);
    const main = await getCliMain();
    await main();
    expect(mockInit).toHaveBeenCalledOnce();
  });

  it('should call the install command', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'install']);
    const main = await getCliMain();
    await main();
    expect(mockInstall).toHaveBeenCalledOnce();
  });

  it('should call the uninstall command', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'uninstall']);
    const main = await getCliMain();
    await main();
    expect(mockUninstall).toHaveBeenCalledOnce();
  });

  it('should call the list command', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'list']);
    const main = await getCliMain();
    await main();
    expect(mockList).toHaveBeenCalledOnce();
  });

  it('should call the run command with a hook name', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'run', 'pre-commit']);
    const main = await getCliMain();
    await main();
    expect(mockRunHook).toHaveBeenCalledWith('pre-commit');
  });

  it('should show an error if run is called without a hook name', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'run']);
    const main = await getCliMain();
    await main();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a hook name'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should show help for --help flag', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', '--help']);
    const main = await getCliMain();
    await main();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: ts-git-hooks <command>'));
  });

  it('should show an error for an unknown command', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'ts-git-hooks', 'unknown-command']);
    const main = await getCliMain();
    await main();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});