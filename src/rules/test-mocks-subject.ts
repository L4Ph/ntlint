import { defineRule } from "../core/rules.ts";

/**
 * Ported from jev-lint `rules/typescript/test-mocks-subject` (MIT).
 *
 * `requires: doubles` is the point of the capability model: without a
 * vocabulary that can find doubles, this rule would report every test as clean
 * of a defect it cannot see. It is skipped instead, and says why.
 */
export default defineRule({
  id: "test-mocks-subject",
  docs: "docs/rules/test-mocks-subject.md",
  severity: "warning",
  requires: ["model", "doubles"],
  kind: "noul",
  calibrated: true,
  threshold: 0.3,
  ask: "The behaviour this test's name attributes to the code under test is performed by a mock or stub, and the assertion reads back the stub's canned value unchanged.",
  criteria: {
    true: "The thing the name says the code does is done by a double: the double returns the value the assertion checks, or the double's call is the outcome being asserted, so the test would pass with the real implementation broken.",
    false:
      "The double stands in for a system outside this code, and the assertion checks what this code did with it -- the resulting value, the state it left, or the arguments it passed for a reason.",
  },
  levels: null,
  gate: (test) => test.facts.doubles > 0,
  require: null,
  candidate: null,
});
