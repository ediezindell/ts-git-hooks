/**
 * Converts a kebab-case string to camelCase.
 * @param str The string to convert.
 * @returns The camelCased string.
 */
export const kebabToCamel = (str: string) =>
	str.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/**
 * Converts a camelCase string to kebab-case.
 * @param str The string to convert.
 * @returns The kebab-cased string.
 */
export const camelToKebab = (str: string) =>
	str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Parses a null-separated string into an array of strings.
 * Filters out empty strings.
 * @param str The string to parse.
 * @returns An array of non-empty strings.
 */
export const parseNullSeparatedList = (str: string): string[] => {
	return str.split("\0").filter((item) => Boolean(item));
};
