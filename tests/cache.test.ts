import { expect, test } from "vite-plus/test";
import { verdictKey } from "../src/core/cache.ts";
import { rule, subject } from "./builders.ts";

const key = (
  overrides: { rule?: ReturnType<typeof rule>; subject?: ReturnType<typeof subject> } = {},
) =>
  verdictKey({
    rule: overrides.rule ?? rule(),
    subject: overrides.subject ?? subject(),
    arm: "bare",
  });

test("the same rule and the same test produce the same key", () => {
  expect(key()).toBe(key());
});

test("a fact change invalidates the verdict", () => {
  // Fixing a vocabulary changes what the model was told. Without this, the fix
  // ships and every cached verdict keeps answering the old, wrong question.
  const before = subject();
  const after = subject({ facts: { ...before.facts, assertions: 0 } });
  expect(key({ subject: after })).not.toBe(key({ subject: before }));
});

test("a threshold change does not invalidate the verdict", () => {
  // Recalibration is free: the answer is unchanged, only the decision moves.
  expect(key({ rule: rule({ threshold: 0.9 }) })).toBe(key({ rule: rule({ threshold: 0.1 }) }));
});

test("editing the question invalidates the verdict", () => {
  expect(key({ rule: rule({ ask: "The test asserts nothing about its name." }) })).not.toBe(key());
});

test("editing the criteria invalidates the verdict", () => {
  // The criteria are shown to the model, so they are part of the question even
  // though they are not the sentence.
  const withCriteria = rule({ criteria: { true: "…", false: "…" } });
  expect(key({ rule: withCriteria })).not.toBe(key());
});

test("a different state arm is a different question", () => {
  const a = verdictKey({ rule: rule(), subject: subject(), arm: "bare" });
  const b = verdictKey({ rule: rule(), subject: subject(), arm: "located" });
  expect(a).not.toBe(b);
});
