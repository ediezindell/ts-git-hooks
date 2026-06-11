import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process for respawn close-handler tests
const mockOn = vi.fn();
const mockSpawn = vi.fn(() => ({ on: mockOn }));
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

// Mock the command modules. These mocks will be used by the dynamic import.
const mockInit = vi.fn();
const mockInstall = vi.fn();
const mockUninstall = vi.fn();
const mockList = vi.fn();
const mockRunHook = vi.fn();

vi.mock("../commands/init.js", () => ({ init: mockInit }));
vi.mock("../commands/install.js", () => ({ install: mockInstall }));
vi.mock("../commands/uninstall.js", () => ({ uninstall: mockUninstall }));
vi.mock("../commands/list.js", () => ({ list: mockList }));
vi.mock("../core/runner.js", () => ({ runHook: mockRunHook }));

describe("CLI entry point", () => {
	let logSpy: vi.SpyInstance;
	let errorSpy: vi.SpyInstance;
	let exitSpy: vi.SpyInstance;

	beforeEach(() => {
		vi.resetAllMocks();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		vi.spyOn(process, "argv", "get").mockReturnValue(["node", "ts-git-hooks"]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const getCliMain = async () => (await import("./index.js")).main;

	it("should call the init command", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"init",
		]);
		const main = await getCliMain();
		await main();
		expect(mockInit).toHaveBeenCalledOnce();
	});

	it("should call the install command", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"install",
		]);
		const main = await getCliMain();
		await main();
		expect(mockInstall).toHaveBeenCalledOnce();
	});

	it("should call the uninstall command", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"uninstall",
		]);
		const main = await getCliMain();
		await main();
		expect(mockUninstall).toHaveBeenCalledOnce();
	});

	it("should call the list command", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"list",
		]);
		const main = await getCliMain();
		await main();
		expect(mockList).toHaveBeenCalledOnce();
	});

	it("should call the run command with a hook name", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"run",
			"pre-commit",
		]);
		const main = await getCliMain();
		await main();
		expect(mockRunHook).toHaveBeenCalledWith("pre-commit");
	});

	it("should show an error if run is called without a hook name", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"run",
		]);
		const main = await getCliMain();
		await main();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("requires a hook name"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("should show help for --help flag", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"--help",
		]);
		const main = await getCliMain();
		await main();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Usage: ts-git-hooks <command>"),
		);
	});

	it("should show an error for an unknown command", async () => {
		vi.spyOn(process, "argv", "get").mockReturnValue([
			"node",
			"ts-git-hooks",
			"unknown-command",
		]);
		const main = await getCliMain();
		await main();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unknown command"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

describe("ensureRuntimeFlags – respawn close handler", () => {
	let exitSpy: vi.SpyInstance;
	let savedNodeEnv: string | undefined;

	beforeEach(() => {
		vi.resetAllMocks();
		savedNodeEnv = process.env.NODE_ENV;
		// Disable the early-return guard so ensureRuntimeFlags actually runs
		process.env.NODE_ENV = "production";
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		// Stub execArgv to have NO strip-types flag → triggers the respawn path
		vi.spyOn(process, "execArgv", "get").mockReturnValue([]);
		// Stub a node version that satisfies the >=22.6.0 guard
		vi.spyOn(process, "versions", "get").mockReturnValue({
			...process.versions,
			node: "22.6.0",
		});
		vi.spyOn(process, "argv", "get").mockReturnValue(["node", "ts-git-hooks"]);
		vi.spyOn(process, "execPath", "get").mockReturnValue("/usr/bin/node");
	});

	afterEach(() => {
		process.env.NODE_ENV = savedNodeEnv;
		vi.restoreAllMocks();
	});

	/** Invoke ensureRuntimeFlags (via a fresh dynamic import) and return the
	 *  "close" handler that was registered on the mock child. */
	const getCloseHandler = async (): Promise<
		(code: number | null, signal: string | null) => void
	> => {
		// Reset module registry so we get a fresh import that runs ensureRuntimeFlags
		vi.resetModules();
		await import("./index.js");
		// mockOn was called as child.on("close", handler)
		const closeCallArgs = mockOn.mock.calls.find(
			(args) => args[0] === "close",
		);
		if (!closeCallArgs) throw new Error("close handler not registered");
		return closeCallArgs[1] as (
			code: number | null,
			signal: string | null,
		) => void;
	};

	it("exits 1 when child is killed by a signal (SIGKILL)", async () => {
		const handler = await getCloseHandler();
		handler(null, "SIGKILL");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("exits 0 when child closes normally with code=0", async () => {
		const handler = await getCloseHandler();
		handler(0, null);
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it("exits 1 when child closes with non-zero code=1", async () => {
		const handler = await getCloseHandler();
		handler(1, null);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("exits 1 when both code and signal are null (fail-closed)", async () => {
		const handler = await getCloseHandler();
		handler(null, null);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
