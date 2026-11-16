import { defineRule } from "@test-lint/core";

/**
 * Ported from jev-lint `rules/typescript/test-name-describes-code` (MIT).
 *
 * The sentence, the criteria and the note are verbatim, because the cutoff was
 * fitted against all three: a cutoff fitted to one wording is not a cutoff for
 * another. `borrowed` says it was measured on jev-lint's corpus, not this one.
 */
export default defineRule({
  id: "test-name-describes-code",
  docs: "docs/rules/test-name-describes-code.md",
  severity: "warning",
  requires: ["model", "test"],
  subject: "test",
  kind: "noul",
  calibration: "borrowed",
  calibrationSource: "jev-lint@af58a3b rules/typescript/test-name-describes-code/rule.yml",
  threshold: 0.72,
  ask: "The operation, input or outcome this test's code exercises is not the one its name names.",
  note: "A weak or missing assertion is not a different outcome. The outcome differs only when the code expects something the name contradicts: an ordinary value where the name says throws or rejects, active where it says rejects, the below-threshold price where it says above. A body that calls the named operation on the named input and then checks a length, checks that something exists, or checks nothing, is about the named thing.",
  criteria: {
    true: "Reading the name and then the code, they are about different things. The operation the code calls is not the one the name says (a lookup where the name says remove, a post where it says reverse); the input or case the code sets up is not the one the name states (three units where the name says above ten, a non-empty list where it says empty); the outcome the code expects is the opposite of the one the name implies (expecting active where the name says rejects); the name promises a throw, a panic, an error or a rejection where the code expects an ordinary value; or the name refers to something -- a sort, a warning, a log line -- that the code never calls and never checks.",
    false:
      "The code calls the operation the name says, on the input the name says, and expects the kind of outcome the name says. That holds however weak the assertion is: a length check, an is_some, a toBeDefined, a bare call with no assertion at all, are still about the named thing, and whether they establish it is a separate question this rule does not ask. A one-word title, a synonym for the operation's name, a compound title whose body covers both parts, and setup that calls other operations before the named one, are all fine.",
  },
  levels: null,
  gate: null,
  require: null,
  candidate: null,
});
