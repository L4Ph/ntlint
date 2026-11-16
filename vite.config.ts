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
    // The published package is the command, so the workspace packages are
    // inlined and only the parser bindings and the two libraries stay external.
    entry: ["packages/cli/src/main.ts"],
    format: ["esm"],
    hash: false,
    dts: false,
    // In-source tests must not survive into the bundle: the guard is false at
    // build time, so the block is dead code and its test helpers are dropped.
    define: { "import.meta.vitest": "undefined" },
    // One file: a command does not benefit from chunks.
    outputOptions: { codeSplitting: false },
    deps: {
      alwaysBundle: [/^@test-lint\//],
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
