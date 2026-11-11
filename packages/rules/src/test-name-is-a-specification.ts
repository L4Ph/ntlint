import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated.
 *
 * The one rule here that reads prose rather than code. It is asked in English,
 * so a suite whose test names are written in another language is out of its
 * range: the model would be judging a name it cannot parse as a specification.
 * That limitation is why the rule is a question rather than a phrase list --
 * `works correctly` is only one spelling of the defect.
 */
export default defineRule({
  id: "test-name-is-a-specification",
  docs: "docs/rules/test-name-is-a-specification.md",
  severity: "info",
  requires: ["model", "test"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "This test's name does not state a behaviour and its expected result.",
  criteria: {
    true: "The name says what is being tested rather than what should happen: a component or method name, a ticket number, a word like works, correctly or should work, or a restatement of the call.",
    false:
      "The name states a behaviour and an expected result, in whatever words this codebase uses for them. A terse name that still names a result is false.",
  },
  levels: null,
  gate: (test) => test.name !== null,
  require: null,
  candidate: null,
});
