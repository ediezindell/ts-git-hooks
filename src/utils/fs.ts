import { promises as fs } from "node:fs";

/**
 * Checks if a file exists at the given path.
 * @param filePath The path to the file.
 * @returns True if the file exists, false otherwise.
 */
export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
