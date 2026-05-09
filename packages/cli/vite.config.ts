import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/cli.ts"],
    clean: true,
    sourcemap: true,
    deps: {
      neverBundle: ["better-sqlite3"],
    },
  },
});
