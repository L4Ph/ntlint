import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated.
 *
 * `nestedAssertions` is structural, so the finding is precise; the question
 * exists because table-driven tests legitimately loop over cases, and the
 * vocabulary's `guard` declarations already treat an in-source guard as
 * transparent rather than as a conditional.
 */
export default defineRule({
  id: "test-structure-is-flat",
  docs: "docs/rules/test-structure-is-flat.md",
  severity: "warning",
  requires: ["model", "assert"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "The assertions in this test sit inside a loop or a conditional, so a changed branch could leave them never running.",
  criteria: {
    true: "An assertion's pass or fail depends on a branch taken in the same body, so a test that reports success may have checked nothing on the path that ran.",
    false:
      "The loop is a table of cases that are each meant to be checked, or the conditional guards an environment the assertion is not about.",
  },
  levels: null,
  gate: (test) => test.facts.nestedAssertions,
  require: null,
  candidate: null,
});
