import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated.
 *
 * This is the criterion r5-test-audit calls T9/D2: prefer an output check, then
 * a state check, then a collaboration check. It cannot be decided from the
 * syntax alone -- whether a call IS the outcome is the question -- so it is
 * asked rather than matched.
 */
export default defineRule({
  id: "test-asserts-the-outcome",
  docs: "docs/rules/test-asserts-the-outcome.md",
  severity: "warning",
  requires: ["model", "assert"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "The assertions check how a collaborator was called rather than what the code under test produced.",
  criteria: {
    true: "The only checks are that a collaborator was called, how many times, or with what arguments, while the value, state or output this code produced is never examined.",
    false:
      "The assertion checks the result -- the returned value, the stored state, the emitted output -- or the call itself is the outcome, such as the single side effect the code exists to perform.",
  },
  levels: null,
  gate: (test) => test.facts.assertions > 0,
  require: null,
  candidate: null,
});
