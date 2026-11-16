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
  "io",
  "nondeterminism",
  // from the runner: what a rule is allowed to touch
  "model",
  "clock",
  "random",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// The vocabulary's shape is defined once, by its valibot schema, and inferred
// here so the loader, the type and the emitted JSON Schema cannot disagree.
export type {
  Guard,
  Predicate,
  Vocab,
  VocabSkip,
  VocabStructure,
  VocabSuite,
  VocabTest,
} from "./schema.ts";

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
  "io",
  "nondeterminism",
] as const satisfies readonly Capability[];

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
  subjectSource: "test" | "suite" | "function" | "file";
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
  /** Assertions that check that a collaborator was called, rather than a result. */
  interactionAssertions: number;
  /** Assertions that compare a value with itself, so they cannot fail. */
  trivialAssertions: number;
  /** Assertions that record output instead of asserting a property of it. */
  snapshots: number;
  doubles: number;
  sleeps: number;
  /** Filesystem, network or subprocess calls inside the test. */
  io: number;
  /** Clock, random or generated-id reads inside the test. */
  nondeterminism: number;
  /** Hooks the enclosing suite declares: setup and teardown the test may rely on. */
  hooks: number;
  skip: string | null;
  /** True when the subject carries an assertion under a loop or a conditional. */
  nestedAssertions: boolean;
  awaits: number;
  /** Another test in the same file has the same name. */
  duplicateName: boolean;
}

/** An answer from Jev, as `readAnswer` returns it. */
export interface Answer {
  value: number;
  confidence: number | null;
  kind: "score" | "noul";
}

/**
 * What a rule judges. A test rule must not run on a suite: `describe(...)`
 * carries tests rather than assertions, so a question about assertions has no
 * answer there and every answer it gets is noise.
 */
export const RULE_SUBJECTS = ["test", "suite", "any"] as const;
export type RuleSubject = (typeof RULE_SUBJECTS)[number];

/** How a cutoff was obtained. See `Rule.calibration`. */
export const CALIBRATIONS = ["fitted", "borrowed", "placeholder"] as const;
export type Calibration = (typeof CALIBRATIONS)[number];

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
  /** Which subject it judges. A test rule never sees a suite. */
  subject: RuleSubject;
  ask: string;
  /**
   * Context for the model only: the exception, the thing it must not read the
   * ask as. Never shown in a finding, and part of the question, so part of the
   * cache key. A cutoff fitted with a note is not a cutoff for the ask alone.
   */
  note: string | null;
  /** The two branches of a `noul`; shown to the model, so part of the question. */
  criteria: { true: string; false: string } | null;
  /** A `score` rule's ordered levels, when the answer is a conclusion. */
  levels: Record<string, string> | null;
  kind: "noul" | "score";
  /** The cutoff in force. Fitted, never guessed: see the rule's `docs`. */
  threshold: number;
  /**
   * Where the cutoff came from. Only `fitted` may produce a violation, because
   * only `fitted` means the threshold was measured against this repository's
   * corpus. `borrowed` was measured somewhere else, against the same question;
   * `placeholder` is a number nobody has measured at all.
   */
  calibration: Calibration;
  /** The file the borrowed cutoff came from, so a reader can check it. */
  calibrationSource: string | null;
  /** False means the question is not worth spending a request on. */
  gate: ((test: TestSubject) => boolean) | null;
  /** False means the answer cannot be used as a verdict for this rule. */
  require: ((answer: Answer) => boolean) | null;
  /** True means the answer is over the cutoff but the claim is a weak one. */
  candidate: ((answer: Answer) => boolean) | null;
}
