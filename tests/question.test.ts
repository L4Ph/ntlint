import { expect, test } from "vite-plus/test";
import { buildQuestion, substitute } from "../src/core/question.ts";
import { answer, rule, subject } from "./builders.ts";

test("the question carries the sentence, the test's name and the facts", () => {
  const q = buildQuestion(rule(), subject({ name: "applies the discount" }), "q0001");
  expect(q.instructions.statement).toBe(rule().ask);
  expect(q.instructions.test).toBe("applies the discount");
  expect(q.instructions.subject).toBe("q0001");
  expect(q.instructions.facts.assertions).toBe(1);
  expect(q.instructions.code).toContain("expect");
});

test("the cutoff never appears in the question", () => {
  // A threshold in the question means every recalibration rewrites it, and then
  // no run can be compared with an earlier one.
  const q = buildQuestion(rule({ threshold: 0.93 }), subject(), "q0001");
  expect(JSON.stringify(q)).not.toContain("0.93");
});

test("a rule that names $NAME has it filled from the subject", () => {
  const ask = "The operation this test names ($NAME) is not the one its body exercises.";
  const built = buildQuestion(rule({ ask }), subject({ name: "rejects an empty cart" }), "q0001");
  expect(built.instructions.statement).toContain("rejects an empty cart");
  expect(built.instructions.statement).not.toContain("$NAME");
});

test("a name-less subject falls back to its file rather than sending an empty claim", () => {
  const q = buildQuestion(rule(), subject({ name: null }), "q0001");
  expect(q.instructions.test).toBe("src/discount.test.ts");
  expect(substitute("about $TITLE", subject({ name: null }))).toBe("about ");
});

test("a score rule asks with its levels instead of criteria", () => {
  const levels = { "1": "clean", "2": "doubtful", "3": "wrong" };
  const q = buildQuestion(rule({ kind: "score", levels, criteria: null }), subject(), "q0001");
  expect(q.type).toBe("score");
  expect(q.criteria).toEqual(levels);
});

test("a rule with no criteria cannot be asked, and says so instead of sending nothing", () => {
  // validateRule refuses this; reaching it means a rule was built in memory and
  // skipped validation, and a question with no branches has no readable answer.
  expect(() => buildQuestion(rule({ criteria: null }), subject(), "q0001")).toThrow(/no criteria/);
});

test("an answer over the cutoff and one under it are both representable", () => {
  // The payload carries no decision; `gate.decide` is what applies the cutoff.
  const q = buildQuestion(rule(), subject(), "q0001");
  expect(q).not.toHaveProperty("threshold");
  expect(answer(0.9).value).toBeGreaterThan(rule().threshold);
});
