export type PackageManager = "npm" | "yarn" | "pnpm";

const USER_AGENT_MAP: Record<string, PackageManager> = {
	yarn: "yarn",
	pnpm: "pnpm",
} as const;

const DEFAULT_PACKAGE_MANAGER: PackageManager = "npm";

let memoizedPackageManager: PackageManager | undefined;

/**
 * For testing purposes ONLY. Resets the memoized package manager.
 */
export const _resetPackageManager = () => {
	memoizedPackageManager = undefined;
};

/**
 * Detects the package manager used to run the current process.
 * Uses the `npm_config_user_agent` environment variable.
 */
export const getPackageManager = (): PackageManager => {
	if (memoizedPackageManager) {
		return memoizedPackageManager;
	}

	const userAgent = process.env.npm_config_user_agent || "";

	// Find the matching package manager based on the user agent prefix.
	const matchedPrefix = Object.keys(USER_AGENT_MAP).find((prefix) =>
		userAgent.startsWith(prefix),
	);

	memoizedPackageManager = matchedPrefix
		? USER_AGENT_MAP[matchedPrefix]
		: DEFAULT_PACKAGE_MANAGER;

	return memoizedPackageManager;
};
