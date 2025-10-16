import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sync } from "./sync";
import * as typeGenerator from "../core/type-generator";

vi.mock("node:fs", () => ({
	promises: {
		writeFile: vi.fn(),
	},
}));

vi.mock("../core/type-generator");

describe("sync command", () => {
	let logSpy: vi.SpyInstance;
	let errorSpy: vi.SpyInstance;

	beforeEach(() => {
		vi.resetAllMocks();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should call the type generator and log success", async () => {
		// Arrange
		vi.mocked(typeGenerator.generateScriptTypes).mockResolvedValue([
			"test",
			"lint",
		]);

		// Act
		await sync();

		// Assert
		expect(typeGenerator.generateScriptTypes).toHaveBeenCalledOnce();
	});

	it("should log an error if type generation fails", async () => {
		// Arrange
		const testError = new Error("Failed to generate types");
		vi.mocked(typeGenerator.generateScriptTypes).mockRejectedValue(testError);

		// Act
		await sync();

		// Assert
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to sync script types:",
			testError,
		);
	});
});