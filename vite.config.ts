import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["packages/*/src/__tests__/**/*.test.ts"],
  },
  staged: {
    "*.{ts,tsx,js,cjs,mjs,mts}": "vp check --fix",
  },
});
