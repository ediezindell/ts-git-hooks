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

/**
 * Formats a log message with prefix, optional label, and icon.
 */
const formatMessage = (icon: string, message: string, label?: string) => {
	const labelPart = label ? `${pc.bold(pc.gray(`[${label}]`))} ` : "";
	return `${PREFIX} ${labelPart}${icon} ${message}`;
};

export const logger = {
	log: (message: string) => {
		console.log(message);
	},
	info: (message: string, label?: string) => {
		console.log(formatMessage(ICONS.info, ` ${message}`, label));
	},
	success: (message: string, label?: string) => {
		console.log(formatMessage(ICONS.success, message, label));
	},
	warn: (message: string, label?: string) => {
		console.log(formatMessage(ICONS.warn, ` ${message}`, label));
	},
	error: (message: unknown, label?: string) => {
		const msg = formatError(message);
		console.error(formatMessage(ICONS.error, msg, label));

		// If it's a "real" error with a stack, it might be useful for debugging if a flag is set,
		// but for now we keep it simple to match previous behavior.
	},
	/**
	 * Creates a scoped logger with a label.
	 * @param label The label to use (e.g. script name).
	 */
	scope: (label: string) => ({
		info: (message: string) => logger.info(message, label),
		success: (message: string) => logger.success(message, label),
		error: (message: unknown) => logger.error(message, label),
	}),
};
