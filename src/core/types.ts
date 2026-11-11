/**
 * What a language looks like to a rule.
 *
 * A vocabulary is the only language-dependent artifact in the tool. Rules read
 * `TestSubject` fields and never name a language; this file is what turns a
 * grammar into those fields.
 *
 * Two conventions, both borrowed from jev-lint because both were paid for:
 *
 * - Unions come from `as const` arrays, so the runtime validator and the type
 *   cannot drift, and the build stays inside `erasableSyntaxOnly`.
 * - `null` means "known to be absent", `undefined` means "not applicable".
 */

/** What a rule or a vocabulary needs before it can say anything. */
export const CAPABILITIES = [
  // from the vocabulary: what the language can be asked about
  "test",
  "assert",
  "skip",
  "sleep",
  "doubles",
  "hooks",
  "snapshot",
  "async",
  // from the runner: what a rule is allowed to touch
  "model",
  "clock",
  "random",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** A vocabulary's own capabilities, derived from what it declares. */
export const VOCAB_CAPABILITIES = [
  "test",
  "assert",
  "skip",
  "sleep",
  "doubles",
  "hooks",
  "snapshot",
  "async",
] as const satisfies readonly Capability[];

/**
 * A container that wraps tests without being test logic.
 *
 * `if (import.meta.vitest)` and `#[cfg(test)] mod tests` are the two that
 * exist. A rule reading "an assertion inside a conditional" must skip them, or
 * every in-source test is a false positive.
 */
export interface Guard {
  kind: string;
  /** Matched against the condition expression's text, as a regex. */
  condition: string | null;
  /** Matched against an attribute's text, as a regex. */
  attribute: string | null;
}

/**
 * A call-shaped thing that counts as an assertion, a double, a sleep or a hook.
 *
 * A bare name is not enough: `assert` is also a variable name, and Python's
 * assertion is a statement rather than a call. `shape` says which.
 */
export interface Predicate {
  shape: "call" | "method" | "macro" | "statement";
  callee: string | null;
  keyword: string | null;
  /** Import sources that make the callee trustworthy, when the language can say. */
  importedFrom: string[];
}

export interface VocabTest {
  /** ast-grep util names that match a test container, as `jev-lint` emits them. */
  utils: string[];
  /** A text marker that identifies a test function, for a grammar with no test kind. */
  marker: string | null;
  /** The node kind that carries a marked test, for a grammar with no test kind. */
  container: string | null;
  guard: Guard[];
}

export interface VocabStructure {
  loop: string[];
  conditional: string[];
  try: string[];
  call: string[];
}

export interface VocabSkip {
  marker: string | null;
  modifiers: string[];
}

export interface Vocab {
  name: string;
  grammars: string[];
  /** The file it was read from, shown whenever two vocabularies collide. */
  source: string;
  test: VocabTest;
  structure: VocabStructure;
  assert: Predicate[];
  double: Predicate[];
  sleep: Predicate[];
  skip: VocabSkip;
  hooks: Predicate[];
  /** Declared, not inferred: a vocabulary that cannot take snapshots says so. */
  snapshot: boolean;
  async: boolean;
}

/** One place a test was found, and the test itself. */
export interface TestSubject {
  file: string;
  language: string;
  /** The vocabulary that found it, so a finding can name the vocabulary's version. */
  vocab: string;
  /**
   * How the subject was found. A rule that expects a whole test must not run
   * on `file`, and a reader must be able to tell the two apart.
   */
  subjectSource: "test" | "function" | "file";
  /** The test's title, or the enclosing function's name, or the file's path. */
  name: string | null;
  /** What the model reads: title and body, or the whole file at step three. */
  text: string;
  line: number;
  endLine: number;
  facts: Facts;
}

/**
 * What the vocabulary resolved, handed to the model as evidence.
 *
 * A rule reads these; it never re-parses the source. That is what keeps one
 * rule valid across languages, and it is why an incomplete vocabulary weakens
 * a question instead of suppressing a verdict.
 */
export interface Facts {
  assertions: number;
  doubles: number;
  sleeps: number;
  skip: string | null;
  /** True when the subject carries an assertion under a loop or a conditional. */
  nestedAssertions: boolean;
  awaits: number;
}

/** An answer from Jev, as `readAnswer` returns it. */
export interface Answer {
  value: number;
  confidence: number | null;
  kind: "score" | "noul";
}

export const SEVERITIES = ["off", "info", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const MESSAGE_IDS = ["violation", "candidate", "unsure", "missing"] as const;
export type MessageId = (typeof MESSAGE_IDS)[number];

export interface Finding {
  ruleId: string;
  file: string;
  line: number;
  endLine: number;
  severity: Severity;
  /** `violation`, `candidate` (weak claim), `unsure` (low confidence), `missing`, or null when the answer was under its cutoff. */
  messageId: MessageId | null;
  /** Whether a reader should see it. A `missing` is never reported. */
  reported: boolean;
  value: number | null;
  confidence: number | null;
  /** The cutoff in force, so a record can be re-gated later. */
  at: number;
  /** `value / at`: the only sound way to rank findings from different rules. */
  margin: number | null;
  subjectSource: TestSubject["subjectSource"];
}

/**
 * One rule, as code.
 *
 * `gate`, `require` and `candidate` are the constraints a YAML rule could not
 * express; they are why a rule is a module rather than a data file.
 */
export interface Rule {
  id: string;
  /** Where a reader finds what it means and why it ships. Required: a finding
   *  an agent cannot look up is a finding it has to guess about. */
  docs: string;
  severity: Severity;
  /** What this rule needs before it can say anything. */
  requires: Capability[];
  ask: string;
  /** The two branches of a `noul`; shown to the model, so part of the question. */
  criteria: { true: string; false: string } | null;
  /** A `score` rule's ordered levels, when the answer is a conclusion. */
  levels: Record<string, string> | null;
  kind: "noul" | "score";
  /** The cutoff in force. Fitted, never guessed: see the rule's `docs`. */
  threshold: number;
  /** False means the question is not worth spending a request on. */
  gate: ((test: TestSubject) => boolean) | null;
  /** False means the answer cannot be used as a verdict for this rule. */
  require: ((answer: Answer) => boolean) | null;
  /** True means the answer is over the cutoff but the claim is a weak one. */
  candidate: ((answer: Answer) => boolean) | null;
}
