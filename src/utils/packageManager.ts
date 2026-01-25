export type PackageManager = "npm" | "yarn" | "pnpm";

let memoizedPackageManager: PackageManager | undefined;

/**
 * For testing purposes ONLY. Resets the memoized package manager.
 */
export const _resetPackageManager = () => {
	memoizedPackageManager = undefined;
};

export const getPackageManager = (): PackageManager => {
	if (memoizedPackageManager) {
		return memoizedPackageManager;
	}

	const userAgent = process.env.npm_config_user_agent || "";

	// Map of user agent prefixes to package managers
	const userAgentMap: Record<string, PackageManager> = {
		yarn: "yarn",
		pnpm: "pnpm",
	};

	// Find matching package manager, default to npm
	const matchedManager =
		Object.entries(userAgentMap).find(([prefix]) =>
			userAgent.startsWith(prefix),
		)?.[1] ?? "npm";

	memoizedPackageManager = matchedManager;
	return memoizedPackageManager;
};
