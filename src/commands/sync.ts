import { generateScriptTypes } from "../core/type-generator";

/**
 * Command to sync type definitions from package.json scripts.
 */
export async function sync() {
	try {
		await generateScriptTypes();
	} catch (error) {
		// The core function already logs the specific error.
		// We catch it here to prevent the process from exiting with a non-zero code
		// unless we want it to. For now, just absorb it.
	}
}
