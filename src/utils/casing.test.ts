import { describe, it, expect } from "vitest";
import { toKebabCase } from "./casing";

describe("toKebabCase", () => {
	it("should convert camelCase to kebab-case", () => {
		expect(toKebabCase("preCommit")).toBe("pre-commit");
		expect(toKebabCase("prepareCommitMsg")).toBe("prepare-commit-msg");
	});

	it("should return kebab-case strings as is", () => {
		expect(toKebabCase("post-commit")).toBe("post-commit");
	});
});