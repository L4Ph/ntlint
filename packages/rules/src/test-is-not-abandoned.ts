import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated. Skipping is not always a defect -- a test
 * skipped until a dependency ships is honest -- so the question asks whether
 * the test was abandoned rather than whether it is skipped.
 */
export default defineRule({
  id: "test-is-not-abandoned",
  docs: "docs/rules/test-is-not-abandoned.md",
  severity: "warning",
  requires: ["model", "skip"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "This test was left abandoned: skipped, focused, or a placeholder with no check, rather than a case the suite runs.",
  criteria: {
    true: "The skip marker has outlived its reason: a placeholder body with no assertion, a case skipped with no reason recorded, or a focused test that silently stops the rest of the suite from running.",
    false:
      "The skip is a current, stated decision -- a dependency that has not shipped, a platform that cannot run it -- and the reason is visible in the test or its marker.",
  },
  levels: null,
  gate: (test) => test.facts.skip !== null,
  require: null,
  candidate: null,
});
