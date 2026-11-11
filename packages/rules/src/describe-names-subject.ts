import { defineRule } from "@test-lint/core";

/**
 * Ported from jev-lint `rules/typescript/describe-names-subject` (MIT).
 *
 * The subject is a suite, not a test: `subjectSource: "suite"`. Its body is the
 * tests inside it, so the model reads the same text it would for a test and the
 * question is about the block as a whole.
 */
export default defineRule({
  id: "describe-names-subject",
  docs: "docs/rules/describe-names-subject.md",
  severity: "warning",
  requires: ["model", "test"],
  kind: "noul",
  calibrated: true,
  threshold: 0.45,
  ask: "The tests inside this describe block exercise something other than what its title ($TITLE) names.",
  criteria: {
    true: "The cases inside the block are about another operation, input or outcome than the title says, so a reader looking for the title's subject finds tests of something else.",
    false:
      "The cases inside are instances of what the title names. A title that is merely generic, such as the name of the module, is not a mismatch.",
  },
  levels: null,
  gate: (test) => test.subjectSource === "suite",
  require: null,
  candidate: null,
});
