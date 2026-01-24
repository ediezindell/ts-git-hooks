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

	if (userAgent.startsWith("yarn")) {
		memoizedPackageManager = "yarn";
	} else if (userAgent.startsWith("pnpm")) {
		memoizedPackageManager = "pnpm";
	} else {
		memoizedPackageManager = "npm";
	}

	return memoizedPackageManager;
};
