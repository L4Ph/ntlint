/**
 * Finding the tests in a source file, and the facts a rule reads.
 *
 * Parsing happens in this process: `@ast-grep/napi` is a native binding, so a
 * run is one Node process with no subprocess to start per file and no JSON
 * stream to join back together.
 *
 * The extractor walks the tree instead of emitting ast-grep rules, because the
 * vocabulary already describes finding a test as data -- a callee regex or a
 * marker -- and one walk over one parse is cheaper than compiling a rule set.
 *
 * Four things it must get right, each of them a bug that shipped before:
 *
 * - **A test is not always in a test file.** In-source tests sit in production
 *   sources, so discovery is by construct and never by path.
 * - **A guard is not test logic.** The conditional wrapping an in-source test
 *   must not count as a branch an assertion sits under.
 * - **A container nests.** A test can sit inside `describe`, inside another
 *   `describe`, inside a callback.
 * - **`SgNode` has no identity.** Two wrappers around the same node are not
 *   `===`, so ancestry is compared by byte range. Comparing by reference made
 *   every assertion look like it sat under the `if` that wraps the whole file.
 */
import { Lang, parse } from "@ast-grep/napi";
import type { SgNode } from "@ast-grep/napi";
import type { Facts, Guard, Predicate, TestSubject, Vocab } from "./types.ts";

/**
 * The grammars this build can parse. `@ast-grep/napi` ships five (Html,
 * JavaScript, Tsx, Css, TypeScript); every other language is a separate
 * `@ast-grep/lang-*` package or a compiled parser, which is a dependency
 * decision rather than a line of code. JSX is parsed by the Tsx grammar, which
 * accepts it.
 */
const GRAMMARS: Partial<Record<string, Lang>> = {
  TypeScript: Lang.TypeScript,
  Tsx: Lang.Tsx,
  JavaScript: Lang.JavaScript,
  Jsx: Lang.Tsx,
};

/** The grammars this build can parse at all; a vocabulary naming another is skipped. */
export function supportedGrammars(vocab: Vocab): string[] {
  return vocab.grammars.filter((g) => GRAMMARS[g] !== undefined);
}

/** Every test and every suite in one source file, in source order. */
export function extract(source: string, file: string, vocab: Vocab): TestSubject[] {
  const grammar = supportedGrammars(vocab)[0];
  if (grammar === undefined) return [];
  const root = parse(GRAMMARS[grammar]!, source).root();

  const tests: SgNode[] = [];
  const suites: SgNode[] = [];
  for (const node of walk(root)) {
    const kind = String(node.kind());
    if (vocab.structure.call.includes(kind)) {
      const callee = calleeText(node);
      if (callee === null) continue;
      if (vocab.test.callee !== null && matches(vocab.test.callee, callee)) {
        tests.push(node);
      } else if (vocab.suite.callee !== null && matches(vocab.suite.callee, callee)) {
        suites.push(node);
      }
      continue;
    }
    // A grammar whose tests are declarations: `#[test] fn`, `def test_`.
    if (vocab.test.container === kind && markerMatches(vocab.test.marker ?? null, node.text())) {
      tests.push(node);
    }
  }

  const names = tests.map((node) => nameOf(node, vocab));
  const subjects = [
    ...tests.map((node) => {
      const name = nameOf(node, vocab);
      return subject(
        node,
        file,
        vocab,
        grammar,
        false,
        name,
        name !== null && names.filter((n) => n === name).length > 1,
      );
    }),
    ...suites.map((node) => subject(node, file, vocab, grammar, true, stringArgument(node), false)),
  ];
  return subjects.sort((a, b) => a.line - b.line);
}

function subject(
  node: SgNode,
  file: string,
  vocab: Vocab,
  grammar: string,
  isSuite: boolean,
  name: string | null,
  duplicateName: boolean,
): TestSubject {
  const range = node.range();
  return {
    file,
    language: grammar,
    vocab: vocab.name,
    subjectSource: isSuite
      ? "suite"
      : vocab.test.container === String(node.kind())
        ? "function"
        : "test",
    name,
    text: node.text(),
    line: range.start.line + 1,
    endLine: range.end.line + 1,
    facts: isSuite ? emptyFacts() : factsOf(node, vocab, duplicateName),
  };
}

function emptyFacts(): Facts {
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

/** Count what a rule can read, inside one test. */
export function factsOf(test: SgNode, vocab: Vocab, duplicateName = false): Facts {
  const facts = { ...emptyFacts(), duplicateName, skip: skipOf(vocab, test) };
  const guards = guardsAround(test, vocab);

  for (const node of walk(test)) {
    const kind = String(node.kind());
    if (kind === "await_expression") facts.awaits += 1;
    if (!vocab.structure.call.includes(kind)) continue;

    const callee = calleeText(node) ?? "";
    const base = calleeBase(node);
    if (matchesAny(vocab.double, callee, base, node)) facts.doubles += 1;
    if (matchesAny(vocab.sleep, callee, base, node)) facts.sleeps += 1;
    if (matchesAny(vocab.io, callee, base, node)) facts.io += 1;
    if (matchesAny(vocab.nondeterminism, callee, base, node)) facts.nondeterminism += 1;
    if (matchesAny(vocab.hooks, callee, base, node) && nodeKey(node) !== nodeKey(test))
      facts.hooks += 1;

    // `expect(x).toBe(y)` is one assertion whose callee is the whole chain; the
    // predicate names `expect`, which is the chain's base. The inner `expect(x)`
    // matches the same predicate and is not a second assertion.
    if (isAssertionReceiver(node)) continue;
    if (!matchesAny(vocab.assert, callee, base, node)) continue;
    facts.assertions += 1;
    if (vocab.interactionMatchers.some((m) => callee.endsWith(`.${m}`) || callee === m)) {
      facts.interactionAssertions += 1;
    }
    if (vocab.snapshotMatchers.some((m) => callee.endsWith(`.${m}`) || callee === m)) {
      facts.snapshots += 1;
    }
    if (isTrivial(node)) facts.trivialAssertions += 1;
    if (underBranch(node, test, guards, vocab)) facts.nestedAssertions = true;
  }
  return facts;
}

// ------------------------------------------------------------------ helpers

function* walk(node: SgNode): Generator<SgNode> {
  for (const child of node.children()) {
    yield child;
    yield* walk(child);
  }
}

/** A node's byte range: `SgNode` wrappers are not comparable by reference. */
function nodeKey(node: SgNode): string {
  const r = node.range();
  return `${r.start.index}:${r.end.index}`;
}

/** The callee's text for a call. */
function calleeText(call: SgNode): string | null {
  return call.child(0)?.text() ?? null;
}

/**
 * The base name of a callee chain: `expect` for `expect(x).toBe(y)`, `vi` for
 * `vi.fn()`, `t` for `t.Fatalf`. A predicate names the base or the whole chain.
 */
function calleeBase(call: SgNode): string {
  return baseOf(call.child(0));
}

function baseOf(node: SgNode | null): string {
  if (node == null) return "";
  const kind = String(node.kind());
  if (kind === "identifier" || kind === "field_expression")
    return node.child(0)?.text() ?? node.text();
  if (kind === "member_expression" || kind === "call_expression") return baseOf(node.child(0));
  return node.text();
}

function matches(pattern: string, text: string): boolean {
  return new RegExp(pattern).test(text);
}

function markerMatches(marker: string | null, text: string): boolean {
  return marker !== null && new RegExp(marker).test(text);
}

function matchesAny(predicates: Predicate[], callee: string, base: string, node: SgNode): boolean {
  return predicates.some((p) => {
    if (p.keyword !== null) return node.text().startsWith(p.keyword);
    if (p.callee === null) return false;
    const re = new RegExp(p.callee);
    return re.test(callee) || re.test(base);
  });
}

/** The first argument of a call, as text. */
function firstArgument(call: SgNode): string | null {
  return call.child(1)?.children()[0]?.text() ?? null;
}

/** `expect(v).toBe(v)`: both sides are the same expression, so it cannot fail. */
function isTrivial(assertion: SgNode): boolean {
  const args =
    assertion
      .child(1)
      ?.children()
      .map((n) => n.text()) ?? [];
  if (args.length === 2 && args[0] === args[1]) return true;
  const fn = assertion.child(0);
  if (fn == null || String(fn.kind()) !== "member_expression") return false;
  const inner = fn.child(0);
  if (inner == null || String(inner.kind()) !== "call_expression") return false;
  const subject = firstArgument(inner);
  const expected = firstArgument(assertion);
  return subject !== null && subject === expected;
}

/** Is this call the receiver of a chained call, `expect(x).toBe(y)` -> `expect(x)`? */
function isAssertionReceiver(call: SgNode): boolean {
  const member = call.parent();
  if (member == null || String(member.kind()) !== "member_expression") return false;
  if (member.child(0) == null || nodeKey(member.child(0)!) !== nodeKey(call)) return false;
  const outer = member.parent();
  return (
    outer != null &&
    outer.kind() === "call_expression" &&
    outer.child(0) != null &&
    nodeKey(outer.child(0)!) === nodeKey(member)
  );
}

function skipOf(vocab: Vocab, test: SgNode): string | null {
  const head = test.text().slice(0, 120);
  for (const modifier of vocab.skip.modifiers) {
    if (new RegExp(`\\.${modifier}\\b`).test(head)) return modifier;
  }
  return markerMatches(vocab.skip.marker, test.text()) ? vocab.skip.marker : null;
}

/** The guards wrapping this test: transparent for the purpose of branching. */
function guardsAround(test: SgNode, vocab: Vocab): Set<string> {
  const guards = new Set<string>();
  for (let node = test.parent(); node != null; node = node.parent()) {
    if (vocab.test.guard.some((g) => g.kind === node!.kind() && guardMatches(g, node!))) {
      guards.add(nodeKey(node));
    }
  }
  return guards;
}

function guardMatches(guard: Guard, node: SgNode): boolean {
  if (guard.condition !== null) {
    const condition = node.child(1)?.text() ?? node.text();
    return new RegExp(guard.condition).test(condition);
  }
  if (guard.attribute !== null) return new RegExp(guard.attribute).test(node.text());
  return true;
}

/** Is this assertion under a loop or a branch, not counting the test's guards? */
function underBranch(node: SgNode, test: SgNode, guards: Set<string>, vocab: Vocab): boolean {
  for (let n = node.parent(); n != null; n = n.parent()) {
    if (nodeKey(n) === nodeKey(test)) return false;
    if (guards.has(nodeKey(n))) continue;
    const kind = String(n.kind());
    if (vocab.structure.loop.includes(kind) || vocab.structure.conditional.includes(kind))
      return true;
  }
  return false;
}

/** The first string literal argument: a suite's or a test's own title. */
function stringArgument(call: SgNode): string | null {
  for (const arg of call.child(1)?.children() ?? []) {
    if (String(arg.kind()) === "string" || String(arg.kind()) === "template_string")
      return unquote(arg.text());
  }
  return null;
}

/** A declaration's name: the identifier it declares, or its title argument. */
function nameOf(node: SgNode, vocab: Vocab): string | null {
  if (vocab.structure.call.includes(String(node.kind()))) return stringArgument(node);
  for (const child of node.children()) {
    if (String(child.kind()) === "identifier" || String(child.kind()) === "property_identifier")
      return child.text();
  }
  return node.children()[0]?.text() ?? null;
}

function unquote(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, "");
}

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { parseVocab } = await import("./vocab.ts");
  const { readFileSync } = await import("node:fs");
  const VOCAB = parseVocab(
    readFileSync(new URL("../vocab/typescript.yml", import.meta.url), "utf-8"),
    "packages/core/vocab/typescript.yml",
  );

  const SOURCE = `
it("applies the discount", () => {
  expect(applyDiscount(cart)).toBe(90);
});

it.skip("does nothing yet", () => {
  vi.fn();
});

it("times out", async () => {
  await sleep(500);
  expect(fetch).toHaveBeenCalled();
});

describe("cart", () => {
  it("applies the discount", () => {
    for (const c of cases) expect(c).toBe(1);
  });
});
`;

  const found = extract(SOURCE, "src/cart.test.ts", VOCAB);
  const byName = (name: string) => found.find((s) => s.name === name);

  test("every test and every suite is found, wherever it sits", () => {
    // Four tests and one suite. A path filter would find none of them, and a
    // top-level-only search would lose the one inside the describe.
    expect(found.filter((s) => s.subjectSource === "test")).toHaveLength(4);
    expect(found.filter((s) => s.subjectSource === "suite")).toHaveLength(1);
  });

  test("subjects come back in source order", () => {
    const lines = found.map((s) => s.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  test("a test carries its own title and body as the thing judged", () => {
    const first = found[0]!;
    expect(first.name).toBe("applies the discount");
    expect(first.text).toContain("expect(applyDiscount(cart)).toBe(90)");
    expect(first.line).toBe(2);
    expect(first.facts.assertions).toBe(1);
  });

  test("a skip marker is a fact, and the modifier names it", () => {
    expect(byName("does nothing yet")?.facts.skip).toBe("skip");
  });

  test("a double, a sleep and an interaction assertion are counted", () => {
    expect(byName("does nothing yet")?.facts.doubles).toBe(1);
    const timed = byName("times out");
    expect(timed?.facts.sleeps).toBe(1);
    // `expect(fetch).toHaveBeenCalled()`: the callee chain's base is `expect`,
    // which is what the vocabulary names.
    expect(timed?.facts.assertions).toBe(1);
    expect(timed?.facts.interactionAssertions).toBe(1);
  });

  test("an assertion under a loop is nested, and one under a guard is not", () => {
    const looped = found.filter((s) => s.name === "applies the discount").at(-1);
    expect(looped?.facts.nestedAssertions).toBe(true);

    const guarded = `if (import.meta.vitest) {
      const { it, expect } = import.meta.vitest;
      it("in source", () => { expect(1).toBe(2); });
    }`;
    const [inSource] = extract(guarded, "src/cart.ts", VOCAB);
    expect(inSource?.facts.assertions).toBe(1);
    expect(inSource?.facts.nestedAssertions).toBe(false);
  });

  test("a duplicate title is a fact, not a separate rule", () => {
    const duplicates = found.filter((s) => s.facts.duplicateName).map((s) => s.name);
    expect(duplicates).toEqual(["applies the discount", "applies the discount"]);
  });

  test("an assertion comparing a value with itself is trivial", () => {
    const [s] = extract('it("x", () => { expect(v).toBe(v); });', "a.test.ts", VOCAB);
    expect(s?.facts.trivialAssertions).toBe(1);
  });

  test("a grammar no vocabulary covers yields nothing rather than a wrong answer", () => {
    expect(extract("anything", "a.cbl", { ...VOCAB, grammars: ["Cobol"] })).toEqual([]);
  });
}
