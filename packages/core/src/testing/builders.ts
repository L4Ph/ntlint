import type { Answer, Rule, TestSubject } from "../types.ts";

export function subject(overrides: Partial<TestSubject> = {}): TestSubject {
  return {
    file: "src/discount.test.ts",
    language: "TypeScript",
    vocab: "typescript",
    subjectSource: "test",
    name: "applies the discount",
    text: 'it("applies the discount", () => { expect(apply(cart)).toBe(90); })',
    line: 3,
    endLine: 5,
    facts: {
      assertions: 1,
      interactionAssertions: 0,
      trivialAssertions: 0,
      snapshots: 0,
      doubles: 0,
      sleeps: 0,
      io: 0,
      nondeterminism: 0,
      hooks: 0,
      skip: null,
      nestedAssertions: false,
      awaits: 0,
      duplicateName: false,
    },
    ...overrides,
  };
}

export function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "test-name-verifies-claim",
    docs: "https://example.test/rules/test-name-verifies-claim",
    severity: "warning",
    requires: ["model"],
    ask: "The assertions in this test verify the behaviour its name claims.",
    criteria: { true: "the claim holds", false: "the claim does not hold" },
    levels: null,
    threshold: 0.5,
    calibrated: true,
    kind: "noul",
    gate: null,
    require: null,
    candidate: null,
    ...overrides,
  };
}

export function answer(value: number, overrides: Partial<Answer> = {}): Answer {
  return { value, confidence: null, kind: "noul", ...overrides };
}
