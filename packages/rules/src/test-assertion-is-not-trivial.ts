import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated.
 *
 * The fact is exact -- an assertion comparing a value with itself cannot fail --
 * so the question is only whether it was meant as a placeholder.
 */
export default defineRule({
  id: "test-assertion-is-not-trivial",
  docs: "docs/rules/test-assertion-is-not-trivial.md",
  severity: "warning",
  requires: ["model", "assert"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "An assertion in this test compares a value with itself, so it cannot fail.",
  criteria: {
    true: "The assertion is a placeholder: the expected value is the actual expression, the same literal on both sides, or a tautology such as asserting that a value equals itself.",
    false:
      "The two sides come from different places -- a value the code produced against one written out, or two independent results -- so the assertion can disagree with the code.",
  },
  levels: null,
  gate: (test) => test.facts.trivialAssertions > 0,
  require: null,
  candidate: null,
});
