import { defineConfig } from "vite-plus";

export default defineConfig({
  // The linter's own tests live in the modules they test. A tool that judges
  // in-source tests should be able to run its own.
  test: {
    includeSource: ["packages/*/src/**/*.ts", "!packages/*/src/**/*.d.ts"],
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
