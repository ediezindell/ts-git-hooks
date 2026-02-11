import { defineConfig } from "rolldown";

const external = [/^node:/, "jiti"];

export default defineConfig({
  input: {
    cli: "src/cli/index.ts",
  },
  platform: "node",
  external,
  output: {
    dir: "dist",
    format: "cjs",
    entryFileNames: "[name].js",
    chunkFileNames: "chunks/[name]-[hash].js",
    sourcemap: true,
  },
});