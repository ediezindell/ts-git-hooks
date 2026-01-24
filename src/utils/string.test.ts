import { describe, expect, it } from "vitest";
import { parseNullSeparatedList } from "./string";

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
