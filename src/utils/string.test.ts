import { describe, expect, it } from "vitest";
import {
	camelToKebab,
	kebabToCamel,
	parseNullSeparatedList,
} from "./string";

describe("kebabToCamel", () => {
	it("should convert kebab-case to camelCase", () => {
		expect(kebabToCamel("pre-commit")).toBe("preCommit");
		expect(kebabToCamel("prepare-commit-msg")).toBe("prepareCommitMsg");
	});

	it("should return the same string if no hyphen", () => {
		expect(kebabToCamel("lint")).toBe("lint");
	});
});

describe("camelToKebab", () => {
	it("should convert camelCase to kebab-case", () => {
		expect(camelToKebab("preCommit")).toBe("pre-commit");
		expect(camelToKebab("prepareCommitMsg")).toBe("prepare-commit-msg");
	});

	it("should handle strings that are already kebab-case (though not ideal)", () => {
		expect(camelToKebab("pre-commit")).toBe("pre-commit");
	});
});

describe("parseNullSeparatedList", () => {
	it("should parse a null-separated string", () => {
		const input = "file1.txt\0file2.txt\0";
		expect(parseNullSeparatedList(input)).toEqual(["file1.txt", "file2.txt"]);
	});

	it("should handle a string without trailing null", () => {
		const input = "file1.txt\0file2.txt";
		expect(parseNullSeparatedList(input)).toEqual(["file1.txt", "file2.txt"]);
	});

	it("should return an empty array for an empty string", () => {
		expect(parseNullSeparatedList("")).toEqual([]);
	});

	it("should return an empty array for a string with only nulls", () => {
		expect(parseNullSeparatedList("\0\0")).toEqual([]);
	});

	it("should handle single item", () => {
		expect(parseNullSeparatedList("file1.txt\0")).toEqual(["file1.txt"]);
	});
});
