import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated. Criterion N5: release what you acquire.
 *
 * The gate is the interesting half: a test that installs a double while its
 * suite has no setup or teardown hook is the shape that leaks into the next
 * test, and a suite with hooks may well restore there.
 */
export default defineRule({
  id: "test-cleans-up-its-doubles",
  docs: "docs/rules/test-cleans-up-its-doubles.md",
  severity: "warning",
  requires: ["model", "doubles", "hooks"],
  kind: "noul",
  calibration: "placeholder",
  calibrationSource: null,
  threshold: 0.5,
  ask: "This test installs a double and leaves it installed, so a later test in the same file can see it.",
  note: null,
  criteria: {
    true: "The double replaces something shared -- a module, a global, a clock -- and nothing in this test or its suite's teardown restores it, so the next test runs against the double.",
    false:
      "The double is restored in the test, in an after-each hook, or by the framework's own automatic restore that this file enables.",
  },
  levels: null,
  gate: (test) => test.facts.doubles > 0 && test.facts.hooks === 0,
  require: null,
  candidate: null,
});
