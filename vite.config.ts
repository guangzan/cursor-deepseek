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
        lines: 70,
        branches: 60,
        functions: 80,
        statements: 70,
      },
    },
  },
  staged: {
    "*.{ts,tsx,js,cjs,mjs,mts}": "vp check --fix",
  },
});
