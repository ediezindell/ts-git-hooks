import { describe, expect, it, vi } from "vitest";
import { getPackageManager } from "./packageManager";

describe("getPackageManager", () => {
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

	it("should throw an error when user agent is not defined", () => {
		// Arrange
		vi.stubEnv("npm_config_user_agent", "");

		// Act & Assert
		expect(() => getPackageManager()).toThrow(
			"Could not determine package manager.",
		);
	});
});
