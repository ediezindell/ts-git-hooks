/**
 * Converts a kebab-case string to camelCase.
 * @param str The string to convert.
 * @returns The camelCased string.
 */
export function kebabToCamel(str: string): string {
	if (!str.includes("-")) return str;
	return str.replace(/-(\w)/g, (_, char) => char.toUpperCase());
}

/**
 * Converts a camelCase string to kebab-case.
 * @param str The string to convert.
 * @returns The kebab-cased string.
 */
export function camelToKebab(str: string): string {
	return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Parses a null-separated Buffer into an array of strings.
 * Filters out empty strings.
 * Optimization: Working directly with Buffer avoids decoding the entire output into a string first,
 * which is significantly more memory-efficient and faster for large outputs.
 */
export function parseNullSeparatedBuffer(buf: Buffer): string[] {
	if (buf.length === 0) return [];

	const result: string[] = [];
	let start = 0;
	let end = buf.indexOf(0);

	while (end !== -1) {
		if (end > start) {
			result.push(buf.toString("utf8", start, end));
		}
		start = end + 1;
		end = buf.indexOf(0, start);
	}

	// Handle the remaining part after the last null byte, if any
	if (start < buf.length) {
		const remainder = buf.toString("utf8", start);
		if (remainder !== "") {
			result.push(remainder);
		}
	}

	return result;
}

/**
 * Parses a null-separated string into an array of strings.
 * Filters out empty strings.
 * @param str The string to parse.
 * @returns An array of non-empty strings.
 */
export function parseNullSeparatedList(str: string): string[] {
	if (str.length === 0) return [];

	const result: string[] = [];
	let start = 0;
	let end = str.indexOf("\0");

	while (end !== -1) {
		if (end > start) {
			result.push(str.substring(start, end));
		}
		start = end + 1;
		end = str.indexOf("\0", start);
	}

	// Handle the remaining part after the last null character, if any
	if (start < str.length) {
		const remainder = str.substring(start);
		if (remainder !== "") {
			result.push(remainder);
		}
	}

	return result;
}
