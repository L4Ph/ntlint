/**
 * Python: pytest and unittest, as they are actually written.
 *
 * A test is a function whose name starts with `test_`, which is the whole
 * convention -- there is no test construct in the grammar. A class named `Test*`
 * is a suite, because pytest collects the tests inside it.
 *
 * The assertion is a statement (`assert x == y`), not a call, and the other half
 * is `self.assertEqual(...)`. Both count, and neither is expressible as a callee
 * regex alone, which is why `shape` was the wrong abstraction and a rule per
 * shape is the right one.
 */
import type { NapiConfig, SgNode } from "@ast-grep/napi";
import { defineLanguage, emptyFacts, fieldText, findAll, isUnder } from "@test-lint/core";
import type { Facts, LanguageDefinition } from "@test-lint/core";
import { parseRegistered } from "./register.ts";

const CALL = (regex: string): NapiConfig => ({
  rule: { kind: "call", has: { field: "function", regex } },
});

/** `assert x == y`: the statement form, which has no callee. */
const ASSERT_STATEMENT: NapiConfig = { rule: { kind: "assert_statement" } };
/** `self.assertEqual(...)`, `self.assertTrue(...)`, and a bare `assert_that(...)`. */
const ASSERT_CALL = CALL("^(self\\.(assert|fail)|assert|pytest\\.raises|pytest\\.fail)");
const DOUBLE = CALL("^(patch|mock\\.patch|Mock|MagicMock|AsyncMock)$");
const SLEEP = CALL("^(time\\.sleep|sleep)$");
const IO = CALL("^(open|requests\\.|urllib\\.|socket\\.|aiohttp\\.)");
const NONDETERMINISM = CALL("^(datetime\\.|time\\.time|random\\.|uuid\\.|uuid4)");
const HOOK = {
  rule: {
    kind: "function_definition",
    has: { field: "name", regex: "^(setUp|tearDown|setup_method|teardown_method)" },
  },
};

const BRANCH = [
  "if_statement",
  "for_statement",
  "while_statement",
  "with_statement",
  "try_statement",
];
const SKIP = /@(pytest\.mark\.(skip|skipif|xfail)|unittest\.skip)|(pytest\.skip|self\.skipTest)\(/;

function nameOf(node: SgNode): string | null {
  const name = fieldText(node, "name");
  return name === "" ? null : name;
}

/**
 * A decorator lives on `decorated_definition`, which wraps the function.
 *
 * Reading the parent's text without checking that kind read the whole module,
 * and every test in a file with one skipped test was reported as skipped.
 */
function isSkipped(node: SgNode): string | null {
  const parent = node.parent();
  if (parent == null || String(parent.kind()) !== "decorated_definition") return null;
  const context = parent.text();
  if (!SKIP.test(context)) return null;
  return /mark\.(skip|skipif|xfail)|unittest\.skip/.exec(context)?.[0] ?? "skip";
}

const python: LanguageDefinition = defineLanguage({
  name: "python",
  extensions: [".py"],
  parse: (source) => parseRegistered("python", source),
  tests: (root) =>
    root
      .root()
      .findAll({ rule: { kind: "function_definition", has: { field: "name", regex: "^test_" } } }),
  suites: (root) =>
    root
      .root()
      .findAll({ rule: { kind: "class_definition", has: { field: "name", regex: "^Test" } } }),
  nameOf,
  facts(node, context) {
    const facts: Facts = {
      ...emptyFacts(),
      duplicateName: context.duplicateName,
      skip: isSkipped(node),
    };

    for (const assertion of [...findAll(node, ASSERT_STATEMENT), ...findAll(node, ASSERT_CALL)]) {
      facts.assertions += 1;
      if (isUnder(assertion, node, BRANCH)) facts.nestedAssertions = true;
    }
    facts.doubles = findAll(node, DOUBLE).length;
    facts.sleeps = findAll(node, SLEEP).length;
    facts.io = findAll(node, IO).length;
    facts.nondeterminism = findAll(node, NONDETERMINISM).length;
    facts.hooks = findAll(node, HOOK).length;
    facts.awaits = findAll(node, { rule: { kind: "await" } }).length;
    return facts;
  },
});

export default python;

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { extract } = await import("@test-lint/core");

  const SOURCE = `
import pytest
from unittest.mock import patch

def test_discount():
    assert apply(cart) == 90

def test_flagged():
    for case in cases:
        assert case.ok

@pytest.mark.skip(reason="later")
def test_later():
    pass

class TestCart:
    def test_rejects(self):
        with pytest.raises(ValueError):
            remove(None)
`;

  const found = extract(SOURCE, "test_cart.py", python);
  const byName = (name: string) => found.find((s) => s.name === name);

  test("finds a test by its name and a suite by its class name", () => {
    expect(found.filter((s) => s.subjectSource === "test").map((s) => s.name)).toEqual([
      "test_discount",
      "test_flagged",
      "test_later",
      "test_rejects",
    ]);
    expect(found.filter((s) => s.subjectSource === "suite").map((s) => s.name)).toEqual([
      "TestCart",
    ]);
  });

  test("counts an assert statement and a self.assert call as assertions", () => {
    expect(byName("test_discount")?.facts.assertions).toBe(1);
    expect(byName("test_rejects")?.facts.assertions).toBe(1);
  });

  test("marks an assert inside a loop as nested", () => {
    expect(byName("test_flagged")?.facts.nestedAssertions).toBe(true);
    expect(byName("test_discount")?.facts.nestedAssertions).toBe(false);
  });

  test("reads a skip marker from the decorator above the function", () => {
    expect(byName("test_later")?.facts.skip).toBe("mark.skip");
    expect(byName("test_discount")?.facts.skip).toBeNull();
  });
}
