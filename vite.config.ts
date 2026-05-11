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
    include: ["packages/*/src/__tests__/**/*.test.ts", "tests/e2e/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/__tests__/**",
        "packages/*/src/**/*.test.ts",
        "packages/*/src/types.ts",
        "packages/*/src/index.ts",
      ],
      thresholds: {
        lines: 65,
        branches: 55,
        functions: 75,
        statements: 65,
      },
    },
  },
  staged: {
    "*.{ts,tsx,js,cjs,mjs,mts}": "vp check --fix",
  },
});
