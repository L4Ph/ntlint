/**
 * TypeScript, and the three grammars that share its syntax.
 *
 * Everything here is ast-grep: a rule selects the tests, a rule selects each
 * fact, and the only code is what ast-grep cannot say -- which callee is whose
 * (by import), whether an assertion compares a value with itself, and whether
 * an assertion sits under a branch.
 */
import { Lang, parse } from "@ast-grep/napi";
import type { NapiConfig, SgNode, SgRoot } from "@ast-grep/napi";
import { defineLanguage, emptyFacts, type LanguageDefinition } from "@test-lint/core";
import type { Facts } from "@test-lint/core";

/**
 * The grammars this build can parse. `@ast-grep/napi` ships five; every other
 * language is a separate `@ast-grep/lang-*` package or a compiled parser. JSX is
 * parsed by the Tsx grammar, which accepts it.
 *
 * A module per grammar only matters where the rules differ, so the four share
 * one: their call shape is the same.
 */
const TEST_CALLEE =
  "^(it|test|specify)(\\.(only|skip|todo|concurrent|sequential|fails|fixme|each|skipIf|runIf)(\\([^)]*\\))?)*$";
const SUITE_CALLEE = "^(describe|context|suite)(\\.(only|skip|each|concurrent)(\\([^)]*\\))?)*$";

/** A call whose callee field matches: ast-grep matches the field, not "child 0". */
const call = (regex: string): NapiConfig => ({
  rule: { kind: "call_expression", has: { field: "function", regex } },
});

const TEST = call(TEST_CALLEE);
const SUITE = call(SUITE_CALLEE);
const ASSERT = call("^expect(\\(|\\.|$)");
const NODE_ASSERT = call(
  "^(assert|ok|equal|notEqual|deepEqual|deepStrictEqual|throws|rejects)(\\.|$)",
);
const DOUBLE = call("^(vi|jest|sinon)\\.");
const SLEEP = call("^(setTimeout|waitForTimeout|sleep|delay|pause)$");
const HOOK = call("^(beforeEach|afterEach|beforeAll|afterAll)$");
const IO = call("^(readFile|readFileSync|writeFile|writeFileSync|mkdir|readdir|fetch)$");
const NONDETERMINISM = call("^(Date\\.now|Math\\.random|randomUUID)$");
const INTERACTION = call(
  "\\.(toHaveBeenCalled|toHaveBeenCalledTimes|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalled|toBeCalledTimes|toBeCalledWith)$",
);
const SNAPSHOT = call("\\.(toMatchSnapshot|toMatchInlineSnapshot|toMatchFileSnapshot)$");

const LOOP = [
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "while_statement",
  "do_statement",
];
const CONDITIONAL = ["if_statement", "ternary_expression", "switch_statement"];

const ASSERT_IMPORTS = [
  "vitest",
  "vite-plus/test",
  "import.meta.vitest",
  "node:assert",
  "node:assert/strict",
];

/** Every call in a test, by rule. */
function findAll(node: SgNode, config: NapiConfig): SgNode[] {
  return node.findAll(config);
}

/** The callee's text, and its root name: `expect(x).toBe(y)` is `expect`. */
function callee(node: SgNode): { text: string; base: string } {
  const fn = node.child(0);
  const text = fn?.text() ?? "";
  return { text, base: baseName(fn) };
}

function baseName(node: SgNode | null): string {
  if (node == null) return "";
  const kind = String(node.kind());
  if (kind === "identifier") return node.text();
  if (kind === "member_expression" || kind === "call_expression") return baseName(node.child(0));
  return node.text();
}

/**
 * Local name to the module it came from, including an in-source destructure.
 *
 * Read from the file, because a name is not an identity: `expect` imported from
 * somewhere else is not this framework's `expect`. A name with no import at all
 * is kept, because the frameworks define these as globals.
 */
function importsOf(root: SgRoot): Map<string, string> {
  const imports = new Map<string, string>();
  for (const node of root.root().findAll({ rule: { kind: "import_statement" } })) {
    const text = node.text();
    const source = /from\s+["']([^"']+)["']/.exec(text)?.[1];
    if (source === undefined) continue;
    const braces = /\{([^}]*)\}/.exec(text)?.[1];
    const names = (braces ?? "").split(",").map((n) =>
      n
        .trim()
        .split(/\s+as\s+/)
        .pop()!,
    );
    for (const name of names.filter(Boolean)) imports.set(name, source);
  }
  for (const node of root.root().findAll({ rule: { kind: "variable_declarator" } })) {
    if (!/import\.meta\.vitest/.test(node.text())) continue;
    const pattern = /\{([^}]*)\}/.exec(node.text())?.[1] ?? "";
    for (const name of pattern.split(",").map((n) => n.trim().split(":").pop()!.trim())) {
      if (name !== "") imports.set(name, "import.meta.vitest");
    }
  }
  return imports;
}

/** A call is trusted when its name came from a source this language knows. */
function trusted(node: SgNode, imports: Map<string, string>, sources: string[]): boolean {
  const source = imports.get(callee(node).base);
  return source === undefined || sources.includes(source);
}

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
  return inner.child(1)?.children()[0]?.text() === assertion.child(1)?.children()[0]?.text();
}

/** Is this node under a loop or a branch, not counting the test's own guard? */
function underBranch(node: SgNode, test: SgNode): boolean {
  const end = test.range().start.index;
  for (const ancestor of node.ancestors()) {
    if (ancestor.range().start.index === end) return false;
    const kind = String(ancestor.kind());
    // The conditional wrapping an in-source test is a guard, not test logic.
    if (kind === "if_statement" && /import\.meta\.vitest/.test(ancestor.text())) continue;
    if (LOOP.includes(kind) || CONDITIONAL.includes(kind)) return true;
  }
  return false;
}

function skipOf(test: SgNode): string | null {
  const text = callee(test).text;
  for (const modifier of ["skip", "only", "todo", "fixme"]) {
    if (new RegExp(`\\.${modifier}\\b`).test(text)) return modifier;
  }
  return null;
}

function nameOf(node: SgNode): string | null {
  for (const arg of node.child(1)?.children() ?? []) {
    const kind = String(arg.kind());
    if (kind === "string" || kind === "template_string")
      return arg.text().replace(/^["'`]|["'`]$/g, "");
  }
  return null;
}

/** A title is required: `describe(f)` and `test(fn)` are ordinary helpers. */
function titled(nodes: SgNode[]): SgNode[] {
  return nodes.filter((node) => nameOf(node) !== null);
}

const typescript: LanguageDefinition = defineLanguage({
  name: "typescript",
  extensions: [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"],
  parse(source) {
    return parse(source.includes("<") ? Lang.Tsx : Lang.TypeScript, source);
  },
  tests: (root) => titled(root.root().findAll(TEST)),
  suites: (root) => titled(root.root().findAll(SUITE)),
  nameOf,
  facts(node, context) {
    const facts: Facts = {
      ...emptyFacts(),
      duplicateName: context.duplicateName,
      skip: skipOf(node),
    };
    const imports = importsOf(node.getRoot());

    for (const assertion of findAll(node, ASSERT)) {
      if (!trusted(assertion, imports, ASSERT_IMPORTS)) continue;
      // `expect(x).toBe(y)` is one assertion; the inner `expect(x)` is not a second.
      if (isChainedReceiver(assertion)) continue;
      facts.assertions += 1;
      if (isTrivial(assertion)) facts.trivialAssertions += 1;
      if (underBranch(assertion, node)) facts.nestedAssertions = true;
    }
    for (const assertion of findAll(node, NODE_ASSERT)) {
      if (!trusted(assertion, imports, ASSERT_IMPORTS)) continue;
      facts.assertions += 1;
      if (underBranch(assertion, node)) facts.nestedAssertions = true;
    }

    facts.interactionAssertions = findAll(node, INTERACTION).length;
    facts.snapshots = findAll(node, SNAPSHOT).length;
    facts.doubles = findAll(node, DOUBLE).length;
    facts.sleeps = findAll(node, SLEEP).length;
    facts.io = findAll(node, IO).length;
    facts.nondeterminism = findAll(node, NONDETERMINISM).length;
    facts.hooks = findAll(node, HOOK).filter(
      (hook) => hook.range().start.index !== node.range().start.index,
    ).length;
    facts.awaits = node.findAll({ rule: { kind: "await_expression" } }).length;
    return facts;
  },
});

/** `expect(x)` inside `expect(x).toBe(y)`: the same assertion, not a second one. */
function isChainedReceiver(call: SgNode): boolean {
  const member = call.parent();
  if (member == null || String(member.kind()) !== "member_expression") return false;
  if (member.child(0)?.range().start.index !== call.range().start.index) return false;
  const outer = member.parent();
  return outer != null && String(outer.kind()) === "call_expression";
}

export default typescript;

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { extract } = await import("@test-lint/core");

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

  const found = extract(SOURCE, "src/cart.test.ts", typescript);
  const byName = (name: string) => found.find((s) => s.name === name);

  test("finds four tests and one suite when one test sits inside a describe", () => {
    expect(found.filter((s) => s.subjectSource === "test")).toHaveLength(4);
    expect(found.filter((s) => s.subjectSource === "suite")).toHaveLength(1);
  });

  test("subjects come back in source order", () => {
    const lines = found.map((s) => s.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  test("keeps the title, the body and the line range of each test", () => {
    const first = found[0]!;
    expect(first.name).toBe("applies the discount");
    expect(first.text).toContain("expect(applyDiscount(cart)).toBe(90)");
    expect(first.line).toBe(2);
    expect(first.facts.assertions).toBe(1);
  });

  test("a table-driven test is found by the rule that matches its callee", () => {
    const [each] = extract(
      'test.each([[1], [2]])("case %i", (n) => { expect(n).toBe(1); });',
      "a.test.ts",
      typescript,
    );
    expect(each?.name).toBe("case %i");
    expect(each?.facts.assertions).toBe(1);
  });

  test("finds no test in describe(f) and none in a bare declaration", () => {
    // `describe(f)` carries no title, so the rule's own requirement drops it.
    expect(extract("describe(f);", "a.ts", typescript)).toEqual([]);
  });

  test("reads a skip modifier from the callee and not from a property in the body", () => {
    expect(byName("does nothing yet")?.facts.skip).toBe("skip");
    const [s] = extract(
      'it("x", () => { expect(a.facts.skip).toBe(null); });',
      "a.test.ts",
      typescript,
    );
    expect(s?.facts.skip).toBeNull();
  });

  test("counts one double, one sleep and one interaction assertion", () => {
    expect(byName("does nothing yet")?.facts.doubles).toBe(1);
    const timed = byName("times out");
    expect(timed?.facts.sleeps).toBe(1);
    expect(timed?.facts.assertions).toBe(1);
    expect(timed?.facts.interactionAssertions).toBe(1);
  });

  test("marks an assertion under a loop as nested and one under a guard as not", () => {
    const looped = found.filter((s) => s.name === "applies the discount").at(-1);
    expect(looped?.facts.nestedAssertions).toBe(true);

    const guarded = `if (import.meta.vitest) {
      const { it, expect } = import.meta.vitest;
      it("in source", () => { expect(1).toBe(2); });
    }`;
    const [inSource] = extract(guarded, "src/cart.ts", typescript);
    expect(inSource?.facts.assertions).toBe(1);
    expect(inSource?.facts.nestedAssertions).toBe(false);
  });

  test("marks both tests with a duplicate title as duplicates", () => {
    const duplicates = found.filter((s) => s.facts.duplicateName).map((s) => s.name);
    expect(duplicates).toEqual(["applies the discount", "applies the discount"]);
  });

  test("an assertion comparing a value with itself is trivial", () => {
    const [s] = extract('it("x", () => { expect(v).toBe(v); });', "a.test.ts", typescript);
    expect(s?.facts.trivialAssertions).toBe(1);
  });

  test("counts an expect imported from vitest and not one imported from chai", () => {
    const [chai] = extract(
      'import { expect } from "chai";\nit("x", () => { expect(1).toBe(2); });',
      "a.test.ts",
      typescript,
    );
    expect(chai?.facts.assertions).toBe(0);
    const [vitest] = extract(
      'import { expect } from "vitest";\nit("x", () => { expect(1).toBe(2); });',
      "a.test.ts",
      typescript,
    );
    expect(vitest?.facts.assertions).toBe(1);
  });

  test("counts a global expect that is never imported", () => {
    const [s] = extract('it("x", () => { expect(1).toBe(2); });', "a.test.ts", typescript);
    expect(s?.facts.assertions).toBe(1);
  });

  test("reads the title argument as the name and finds no test in other code", () => {
    expect(extract("const it = 1;", "a.ts", typescript)).toEqual([]);
    expect(extract('it.todo("later");', "a.test.ts", typescript)[0]?.name).toBe("later");
  });
}
