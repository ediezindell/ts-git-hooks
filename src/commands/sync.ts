import { generateScriptTypes } from "../core/type-generator";

/**
 * Command to sync type definitions from package.json scripts.
 */
export async function sync() {
	try {
		await generateScriptTypes();
	} catch (error) {
		console.error("Failed to sync script types:", error);
		process.exit(1);
	}
}