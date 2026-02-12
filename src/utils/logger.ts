import pc from "picocolors";

const PREFIX = pc.bold(pc.cyan("ts-git-hooks"));

const ICONS = {
	info: pc.blue("ℹ"),
	success: pc.green("✅"),
	warn: pc.yellow("⚠️"),
	error: pc.red("❌"),
} as const;

/**
 * Extracts a message string from an unknown error type.
 */
const formatError = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

export const logger = {
	log: (message: string) => {
		console.log(message);
	},
	info: (message: string) => {
		console.log(`${PREFIX} ${ICONS.info}  ${message}`);
	},
	success: (message: string) => {
		console.log(`${PREFIX} ${ICONS.success} ${message}`);
	},
	warn: (message: string) => {
		console.log(`${PREFIX} ${ICONS.warn}  ${message}`);
	},
	error: (message: unknown) => {
		const msg = formatError(message);

		console.error(`${PREFIX} ${ICONS.error} ${msg}`);

		// If it's a "real" error with a stack, it might be useful for debugging if a flag is set,
		// but for now we keep it simple to match previous behavior.
	},
	/**
	 * Creates a scoped logger with a label.
	 * @param label The label to use (e.g. script name).
	 */
	scope: (label: string) => {
		const scopedPrefix = pc.bold(pc.gray(`[${label}]`));
		return {
			info: (message: string) => {
				console.log(`${PREFIX} ${scopedPrefix} ${ICONS.info}  ${message}`);
			},
			success: (message: string) => {
				console.log(`${PREFIX} ${scopedPrefix} ${ICONS.success} ${message}`);
			},
			error: (message: unknown) => {
				const msg = formatError(message);
				console.error(`${PREFIX} ${scopedPrefix} ${ICONS.error} ${msg}`);
			},
		};
	},
};
