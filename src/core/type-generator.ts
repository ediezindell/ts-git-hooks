import { promises as fs } from "node:fs";
import { logger } from "../utils/logger";

const typeDefFileName = "git-hooks.d.ts";

/**
 * Generates a TypeScript type definition string from a list of script names.
 * @param scriptNames An array of npm script names.
 * @returns A string containing the TypeScript type definition.
 */
function generateTypeDefContent(scriptNames: string[]): string {
	if (scriptNames.length === 0) {
		return "export type PackageScripts = never;\n";
	}
	const typeString = scriptNames.map((name) => `"${name}"`).join(" | ");
	return `export type PackageScripts = ${typeString};\n`;
}

/**
 * Extracts script names from package.json in the current directory.
 * @returns A promise that resolves to an array of script names.
 */
async function getPackageScriptNames(): Promise<string[]> {
	try {
		const content = await fs.readFile("package.json", "utf-8");
		const pkg = JSON.parse(content);
		return Object.keys(pkg.scripts || {});
	} catch (error: unknown) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			throw new Error("package.json not found");
		}
		throw error;
	}
}

/**
 * Reads package.json, extracts script names, and generates a .d.ts file.
 * @returns A promise that resolves when the file is written.
 */
export async function generateScriptTypes(): Promise<void> {
	try {
		const scriptNames = await getPackageScriptNames();
		const typeDefContent = generateTypeDefContent(scriptNames);

		await fs.writeFile(typeDefFileName, typeDefContent, "utf-8");

		logger.success(
			`Type definitions for npm scripts have been updated in '${typeDefFileName}'.`,
		);
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : "An unexpected error occurred";

		if (message === "package.json not found") {
			logger.error("Error: package.json not found in the current directory.");
		} else {
			logger.error("An error occurred while generating type definitions:");
			logger.error(error);
		}

		throw error;
	}
}
