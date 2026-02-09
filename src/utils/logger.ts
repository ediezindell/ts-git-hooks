import pc from "picocolors";

const PREFIX = pc.bold(pc.cyan("ts-git-hooks"));

export const logger = {
	log: (message: string) => {
		console.log(message);
	},
	info: (message: string) => {
		console.log(`${PREFIX} ${pc.blue("ℹ")}  ${message}`);
	},
	success: (message: string) => {
		console.log(`${PREFIX} ${pc.green("✅")} ${message}`);
	},
	warn: (message: string) => {
		console.log(`${PREFIX} ${pc.yellow("⚠️")}  ${message}`);
	},
	error: (message: string | unknown) => {
		const msg = message instanceof Error ? message.message : String(message);
		console.error(`${PREFIX} ${pc.red("❌")} ${msg}`);
	},
	/**
	 * Creates a scoped logger with a label.
	 * @param label The label to use (e.g. script name).
	 */
	scope: (label: string) => {
		const scopedPrefix = pc.bold(pc.gray(`[${label}]`));
		return {
			info: (message: string) => {
				console.log(`${PREFIX} ${scopedPrefix} ${pc.blue("ℹ")}  ${message}`);
			},
			success: (message: string) => {
				console.log(`${PREFIX} ${scopedPrefix} ${pc.green("✅")} ${message}`);
			},
			error: (message: string | unknown) => {
				const msg =
					message instanceof Error ? message.message : String(message);
				console.error(`${PREFIX} ${scopedPrefix} ${pc.red("❌")} ${msg}`);
			},
		};
	},
};
