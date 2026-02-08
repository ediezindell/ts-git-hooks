import pc from "picocolors";

const PREFIX = pc.bold(pc.cyan("ts-git-hooks"));

const ICONS = {
	info: pc.blue("ℹ"),
	success: pc.green("✅"),
	warn: pc.yellow("⚠️"),
	error: pc.red("❌"),
} as const;

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
		const msg =
			message instanceof Error
				? message.message
				: typeof message === "string"
					? message
					: String(message);

		console.error(`${PREFIX} ${ICONS.error} ${msg}`);

		// If it's a "real" error with a stack, it might be useful for debugging if a flag is set,
		// but for now we keep it simple to match previous behavior.
	},
};
