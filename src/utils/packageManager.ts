export type PackageManager = "npm" | "yarn" | "pnpm";

const VALID_PACKAGE_MANAGERS = new Set<string>(["npm", "yarn", "pnpm"]);

/**
 * Runtime guard for shell-concatenation sinks. The type system narrows
 * call sites to PackageManager already, but this re-checks at the producer
 * so a future map/cast bug cannot leak an arbitrary string into
 * `${pm} run ...` style command strings executed under `shell: true`.
 */
export function assertValidPackageManager(
	value: string,
): asserts value is PackageManager {
	if (!VALID_PACKAGE_MANAGERS.has(value)) {
		throw new Error(`Invalid package manager: ${JSON.stringify(value)}`);
	}
}

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

	const resolved = matchedPrefix
		? USER_AGENT_MAP[matchedPrefix]
		: DEFAULT_PACKAGE_MANAGER;

	assertValidPackageManager(resolved);
	memoizedPackageManager = resolved;
	return memoizedPackageManager;
};
