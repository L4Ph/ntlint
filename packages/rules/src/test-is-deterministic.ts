import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated. Criterion N3: the clock, randomness and ids
 * are injected or fixed.
 *
 * Reads of the clock are legitimate in a test about time, which is why this is
 * a question and not a finding.
 */
export default defineRule({
  id: "test-is-deterministic",
  docs: "docs/rules/test-is-deterministic.md",
  severity: "warning",
  requires: ["model", "nondeterminism"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "This test reads the wall clock, randomness or a generated id directly, so the same code can produce a different result on another run.",
  criteria: {
    true: "The value that decides the assertion comes from the real clock, real randomness or a real generated id, and nothing in the test pins it, so a run at another moment can disagree.",
    false:
      "Time or randomness is what the test establishes, and the test controls it: a fake clock advanced deliberately, a seeded generator, an id passed in as an argument.",
  },
  levels: null,
  gate: (test) => test.facts.nondeterminism > 0,
  require: null,
  candidate: null,
});
