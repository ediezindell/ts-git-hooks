import { promises as fs } from "node:fs";

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
 * Reads package.json, extracts script names, and generates a .d.ts file.
 * @returns A promise that resolves when the file is written.
 */
export async function generateScriptTypes(): Promise<void> {
	try {
		const packageJsonContent = await fs.readFile("package.json", "utf-8");
		const packageJson = JSON.parse(packageJsonContent);
		const scripts = packageJson.scripts || {};
		const scriptNames = Object.keys(scripts);

		const typeDefContent = generateTypeDefContent(scriptNames);

		await fs.writeFile(typeDefFileName, typeDefContent, "utf-8");
		console.log(
			`Type definitions for npm scripts have been updated in '${typeDefFileName}'.`,
		);
	} catch (error: any) {
		if (error.code === "ENOENT") {
			console.error("Error: package.json not found in the current directory.");
			// Re-throw a simpler error to make testing easier
			throw new Error("package.json not found");
		} else {
			console.error(
				"An error occurred while generating type definitions:",
				error,
			);
			throw error;
		}
	}
}