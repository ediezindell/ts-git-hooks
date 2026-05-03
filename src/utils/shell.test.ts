import { describe, expect, it } from "vitest";
import { quote } from "./shell";

describe("quote", () => {
	it("returns an empty string for an empty input", () => {
		expect(quote([])).toBe("");
	});

	it("joins plain words with spaces, no quoting needed", () => {
		expect(quote(["a", "b", "c"])).toBe("a b c");
	});

	it("single-quotes paths containing spaces", () => {
		expect(quote(["foo bar.ts"])).toBe("'foo bar.ts'");
	});

	it("escapes shell metacharacters that would otherwise break out", () => {
		// `;` would terminate the current command; the quoted form must keep it inert.
		const result = quote(["normal.ts", "; rm -rf /"]);
		expect(result).toBe("normal.ts '; rm -rf /'");
	});

	it("handles single quotes inside the input by switching to double quotes", () => {
		expect(quote(["o'brien.ts"])).toBe(`"o'brien.ts"`);
	});

	it("preserves dollar and backtick semantics so they do not expand", () => {
		const result = quote(["$(touch EXPLOITED).ts", "`whoami`"]);
		// The exact escape form is shell-quote's responsibility; assert that the
		// dangerous tokens are not left at the top level (they must be inside quotes).
		expect(result.startsWith("$(") || result.includes(" $(")).toBe(false);
		expect(result.startsWith("`") || result.includes(" `")).toBe(false);
	});
});
