import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetPackageManager,
	assertValidPackageManager,
	getPackageManager,
} from "./packageManager";

describe("getPackageManager", () => {
	beforeEach(() => {
		_resetPackageManager();
	});

	it("should return 'npm' when user agent starts with npm", () => {
		// Arrange
		vi.stubEnv("npm_config_user_agent", "npm/8.1.2 node/v16.13.1 linux x64");

		// Act & Assert
		expect(getPackageManager()).toBe("npm");
	});

	it("should return 'yarn' when user agent starts with yarn", () => {
		// Arrange
		vi.stubEnv("npm_config_user_agent", "yarn/1.22.17 node/v16.13.1 linux x64");

		// Act & Assert
		expect(getPackageManager()).toBe("yarn");
	});

	it("should return 'pnpm' when user agent starts with pnpm", () => {
		// Arrange
		vi.stubEnv("npm_config_user_agent", "pnpm/6.24.4 node/v16.13.1 linux x64");

		// Act & Assert
		expect(getPackageManager()).toBe("pnpm");
	});

	it("should return 'npm' when user agent is not defined", () => {
		// Arrange
		vi.stubEnv("npm_config_user_agent", "");

		// Act & Assert
		expect(getPackageManager()).toBe("npm");
	});
});

describe("assertValidPackageManager", () => {
	it("accepts the three known package managers", () => {
		expect(() => assertValidPackageManager("npm")).not.toThrow();
		expect(() => assertValidPackageManager("yarn")).not.toThrow();
		expect(() => assertValidPackageManager("pnpm")).not.toThrow();
	});

	it("throws on an unknown value (defends string concatenation sinks against shell injection)", () => {
		expect(() => assertValidPackageManager("bun; rm -rf /")).toThrow();
		expect(() => assertValidPackageManager("")).toThrow();
		expect(() => assertValidPackageManager("NPM")).toThrow();
	});
});
