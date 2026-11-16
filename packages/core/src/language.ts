/**
 * A language is code, not a data file.
 *
 * Finding a test and counting what a rule reads is parsing: it is ast-grep
 * work, against ast-grep's own rule vocabulary, and it belongs in a module the
 * type checker and the tests can see. A YAML file with a private dialect for the
 * same thing is a second copy of ast-grep's config, a validator for that copy,
 * and a translation layer between them -- three things to keep in step for no
 * capability the code does not already have.
 *
 * What a language must answer:
 *
 * - **Which nodes are tests, and which are suites.** An ast-grep rule, because
 *   selection fails silently: a test the matcher misses is never asked about and
 *   appears in no report.
 * - **What a test's own name is.** Read from the node, whatever shape the
 *   framework uses.
 * - **What a rule can read inside it.** Facts, computed by the language with
 *   ast-grep, since only the language knows that `vi.fn()` is a double and
 *   `thread::sleep` is a wait.
 */
import type { SgNode, SgRoot } from "@ast-grep/napi";
import type { Facts, TestSubject } from "./types.ts";

export interface LanguageDefinition {
  /** The name a finding carries, and the name a rule's `requires` matches. */
  name: string;
  /** Extensions this language claims, with the dot. */
  extensions: string[];
  /** Parse one file. The language owns the choice of grammar. */
  parse(source: string): SgRoot;
  /** Every test in the file, as ast-grep selected it. */
  tests(root: SgRoot): SgNode[];
  /** Every suite: a block that groups tests without being one. */
  suites(root: SgRoot): SgNode[];
  /** The test's own title, or the name it declares. */
  nameOf(node: SgNode): string | null;
  /** What a rule can read inside this test. */
  facts(node: SgNode, context: { duplicateName: boolean }): Facts;
  /** How this node was found, for a reader who needs to know. */
  subjectSource?(node: SgNode): "test" | "function";
}

/** Authoring helper: keeps the literal's type checked without losing its shape. */
export function defineLanguage(language: LanguageDefinition): LanguageDefinition {
  return language;
}

/** Every test and every suite in one file, in source order. */
export function extract(source: string, file: string, language: LanguageDefinition): TestSubject[] {
  const root = language.parse(source);
  const tests = language.tests(root);
  const names = tests.map((node) => language.nameOf(node));
  const count = (name: string | null) =>
    name === null ? 0 : names.filter((n) => n === name).length;

  const subjects = [
    ...tests.map((node) => {
      const name = language.nameOf(node);
      return subject(
        node,
        file,
        language,
        "test",
        name,
        language.facts(node, { duplicateName: count(name) > 1 }),
      );
    }),
    ...language
      .suites(root)
      .map((node) => subject(node, file, language, "suite", language.nameOf(node), emptyFacts())),
  ];
  return subjects.sort((a, b) => a.line - b.line);
}

function subject(
  node: SgNode,
  file: string,
  language: LanguageDefinition,
  kind: "test" | "suite",
  name: string | null,
  facts: Facts,
): TestSubject {
  const range = node.range();
  return {
    file,
    language: language.name,
    subjectSource: kind === "suite" ? "suite" : (language.subjectSource?.(node) ?? "test"),
    name,
    text: node.text(),
    line: range.start.line + 1,
    endLine: range.end.line + 1,
    facts,
  };
}

/** A suite carries tests, not assertions: nothing to count. */
export function emptyFacts(): Facts {
  return {
    assertions: 0,
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
  };
}
