import { defineRule } from "@test-lint/core";

/**
 * Ported from jev-lint `rules/typescript/test-mocks-subject` (MIT).
 *
 * `requires: doubles` is the point of the capability model: a language whose
 * vocabulary cannot find a double would get "clean" for a defect the rule
 * cannot see, so it is skipped and says why.
 */
export default defineRule({
  id: "test-mocks-subject",
  docs: "docs/rules/test-mocks-subject.md",
  severity: "warning",
  requires: ["model", "doubles"],
  subject: "test",
  kind: "noul",
  calibration: "borrowed",
  calibrationSource: "jev-lint@af58a3b rules/typescript/test-mocks-subject/rule.yml",
  threshold: 0.3,
  ask: "The behaviour this test's name attributes to the code under test is performed by a mock or stub, and the assertion reads back the stub's canned value unchanged.",
  note: "A title like \"sends an email\" whose assertion is about the call on a mocked mailer is not this rule's concern: the mailer is the boundary. Whether an assertion on a mock's call log is strong enough is a separate question.",
  criteria: {
    true: "The title says the code under test computes, applies, derives, reserves or returns something, but the function, method or module that would do it is replaced -- the module is under vi.mock or jest.mock with a fake implementation, the method has mockReturnValue or mockResolvedValue, a stubbed global resolves to a fixed payload -- and the value the assertion checks can be traced to that stub's configuration with none of the subject's own logic in between: the constant it was told to return, the payload it was given, its fake's arithmetic. The assertion then checks the test's own setup, and the claimed behaviour never runs.",
    false:
      "The stub stands in for a collaborator the code under test calls -- the network, the clock, a repository, a mailer, an event bus -- and the assertion checks what the real code did with the stub's output rather than the output itself: a value it derived, an error it raised, a call it made, how many times it tried; or the title is itself about the collaborator; or the spy has no replacement value and the real method runs.",
  },
  levels: null,
  gate: (test) => test.facts.doubles > 0,
  require: null,
  candidate: null,
});
