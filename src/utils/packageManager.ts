export type PackageManager = "npm" | "yarn" | "pnpm";

export const getPackageManager = (): PackageManager => {
	const userAgent = process.env.npm_config_user_agent;

	if (!userAgent) {
		throw new Error(
			"Could not determine package manager. Please run this command through npm, yarn, or pnpm.",
		);
	}

	if (userAgent.startsWith("yarn")) {
		return "yarn";
	}

	if (userAgent.startsWith("pnpm")) {
		return "pnpm";
	}

	return "npm";
};
