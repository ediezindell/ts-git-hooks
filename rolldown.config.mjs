import { defineConfig } from "rolldown";

export default defineConfig([
	{
		input: "dist/index.js",
		platform: "node",
		output: {
			file: "dist/index.cjs",
			format: "cjs",
			inlineDynamicImports: true,
		},
	},
	{
		input: "dist/cli/index.js",
		platform: "node",
		output: {
			file: "dist/cli/index.cjs",
			format: "cjs",
			banner: "#!/usr/bin/env node",
			inlineDynamicImports: true,
		},
	},
]);