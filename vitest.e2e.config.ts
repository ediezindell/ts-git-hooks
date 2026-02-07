import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		watch: false,
		include: ["src/e2e/**/*.spec.ts"],
	},
});
