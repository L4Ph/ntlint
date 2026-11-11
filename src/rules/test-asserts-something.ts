import { defineRule } from "../core/rules.ts";

/**
 * New in this tool; the cutoff is a placeholder until a canary set has been
 * measured, so it is not calibrated and a run skips it unless asked.
 *
 * The gate is the interesting half: a test with at least one assertion is not
 * asked, because the common false positive is an assertion one call below. The
 * model still judges the zero-assertion cases, where the vocabulary cannot tell
 * a helper apart from nothing.
 */
export default defineRule({
  id: "test-asserts-something",
  docs: "docs/rules/test-asserts-something.md",
  severity: "warning",
  requires: ["model", "assert"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "This test asserts nothing about what the code did.",
  criteria: {
    true: "No assertion in this body, and no call to a helper visible here that could assert, checks anything about the result.",
    false:
      "Something in this body fails when the code misbehaves: an assertion, or a call whose own body asserts. A test that only calls the code and returns is true.",
  },
  levels: null,
  gate: (test) => test.facts.assertions === 0,
  require: null,
  candidate: null,
});
