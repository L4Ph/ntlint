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
  subject: "suite",
  kind: "noul",
  calibration: "borrowed",
  calibrationSource: "jev-lint@af58a3b rules/typescript/describe-names-subject/rule.yml",
  threshold: 0.45,
  ask: "The tests inside this describe block exercise something other than what its title ($TITLE) names.",
  note: "Judge the block as a whole against its title; whether each individual test's own name fits its body is a separate rule. Set-up in beforeEach, helpers defined inside the block, and nested describe blocks all count as part of what the block exercises. A title naming a behaviour or feature is honoured when the tests make it happen and check the result, whatever function they call to do so. Only what the block's own code shows is evidence: whether a function the tests call happens to invoke the named one internally is not visible here and is not assumed.",
  criteria: {
    true: "The title names a specific function, method, class or module and no test in the block calls, constructs or otherwise reaches it: every test calls a differently named sibling instead (a block titled parseConfig whose tests only call loadConfig, a block titled removeItem whose tests only call addItem); or the title names a class and the tests only exercise a free-standing helper, never the class or anything that constructs it; or the title names a behaviour and no test makes that behaviour happen or observes it (a block titled retry whose tests only compute delays and never retry anything).",
    false:
      "What the title names is what the tests exercise, directly or through something that reaches it: a feature or behaviour tested through a public function of another name, as long as the tests set up and observe that behaviour; a class tested through its factory function, through an instance created in beforeEach, or through nested blocks named for its methods; a function called through a small wrapper defined inside the block; a title that is a file name, a scenario, a condition or a whole sentence rather than a symbol, when the tests are about that file, scenario or condition; a title that is an abbreviation, synonym or qualified form of what the tests call; and a block where most tests exercise the named thing and one touches a neighbour on the way.",
  },
  levels: null,
  gate: (test) => test.subjectSource === "suite",
  require: null,
  candidate: null,
});
