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
