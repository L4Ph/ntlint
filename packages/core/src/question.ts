/**
 * Turning one rule and one test into one question.
 *
 * Two things deliberately never appear in a question:
 *
 * - **The cutoff.** It is the decision the runner makes from the answer.
 *   Writing it in would mean every recalibration rewrites the question, and no
 *   run could be compared with an earlier one.
 * - **Anything the subject cannot show.** An exception phrased in terms of
 *   something outside the test -- "unless the suite covers it elsewhere" --
 *   makes every answer land mid-scale, which reads as a threshold problem and
 *   is not one.
 *
 * What does appear is the vocabulary's facts. They are evidence the model may
 * use, never a verdict: a language with an incomplete vocabulary sends fewer
 * facts and the model still reads the source.
 */
import type { Facts, Rule, TestSubject } from "./types.ts";
import { answer, rule, subject } from "./testing/builders.ts";

export interface Question {
  type: "noul" | "score";
  instructions: {
    task: string;
    statement: string;
    subject: string;
    /** The test's own name, quoted so the model knows which claim is judged. */
    test: string;
    /** What the vocabulary resolved. Evidence, not a verdict. */
    facts: Facts;
    code: string;
  };
  /** The branches or the levels. Never the cutoff. */
  criteria: Record<string, string>;
}

const TASK =
  "Judge only the test identified below, and only for the statement given -- other problems with it are not your concern here.";

/** The answer's identity, so answers map back by name rather than by position. */
export function questionId(index: number): string {
  return `q${String(index).padStart(4, "0")}`;
}

export function buildQuestion(rule: Rule, subject: TestSubject, id: string): Question {
  const criteria = rule.kind === "noul" ? rule.criteria : rule.levels;
  if (criteria === null) {
    // `validateRule` refuses this, so reaching it means a rule was built in
    // memory and skipped validation. Failing loudly beats sending a question
    // whose answer nobody can read.
    throw new Error(`${rule.id}: no criteria or levels to ask against`);
  }
  return {
    type: rule.kind,
    instructions: {
      task: TASK,
      statement: substitute(rule.ask, subject),
      subject: id,
      test: subject.name ?? subject.file,
      facts: subject.facts,
      code: subject.text,
    },
    criteria,
  };
}

/**
 * `$NAME` and `$TITLE` are filled from the subject when the rule names them.
 *
 * A rule that says "the operation this test names" is answerable; one that says
 * "does this body do what `$NAME` promises" is answerable about a specific
 * string, which is jev-lint's reason for capturing names in the first place.
 */
export function substitute(ask: string, subject: TestSubject): string {
  const name = subject.name ?? "";
  return ask.replace(/\$NAME|\$TITLE/g, name);
}

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

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
    expect(() => buildQuestion(rule({ criteria: null }), subject(), "q0001")).toThrow(
      /no criteria/,
    );
  });

  test("an answer over the cutoff and one under it are both representable", () => {
    // The payload carries no decision; `gate.decide` is what applies the cutoff.
    const q = buildQuestion(rule(), subject(), "q0001");
    expect(q).not.toHaveProperty("threshold");
    expect(answer(0.9).value).toBeGreaterThan(rule().threshold);
  });
}
