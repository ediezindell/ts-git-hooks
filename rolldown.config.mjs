import { defineConfig } from "rolldown";
import pkg from "./package.json" with { type: "json" };

const external = [
	...Object.keys(pkg.dependencies || {}),
	/^node:/,
];

export default defineConfig([
	{
		input: "dist/index.js",
		platform: "node",
		external,
		output: {
			file: "dist/index.cjs",
			format: "cjs",
		},
	},
	{
		input: "dist/cli/index.js",
		platform: "node",
		external,
		output: {
			file: "dist/cli/index.cjs",
			format: "cjs",
		},
	},
]);