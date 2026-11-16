/**
 * Go: `func TestXxx(t *testing.T)`, where the assertion is a method on the
 * testing handle rather than a framework call.
 *
 * `t.Fatal`, `t.Fatalf`, `t.Error` and `t.FailNow` are the assertions; there is
 * no `expect`. A `t.Skip` is both a skip and the end of the test, which is why it
 * is read from the callee of a call inside the body.
 */
import type { NapiConfig, SgNode } from "@ast-grep/napi";
import { defineLanguage, emptyFacts, findAll, fieldText, isUnder } from "@test-lint/core";
import type { Facts, LanguageDefinition } from "@test-lint/core";
import { parseRegistered } from "./register.ts";

const CALL = (regex: string): NapiConfig => ({
  rule: { kind: "call_expression", has: { field: "function", regex } },
});

/** A test: a top-level function whose name starts with `Test`. */
const TEST: NapiConfig = {
  rule: { kind: "function_declaration", has: { field: "name", regex: "^Test" } },
};
/** `t.Fatal(...)`, `t.Errorf(...)`: the failure IS the assertion in Go. */
const ASSERT = CALL("^[a-z]\\.(Fatal|Fatalf|Error|Errorf|Fail|FailNow)$");
const SKIP = CALL("^[a-z]\\.(Skip|Skipf|SkipNow)$");
const SLEEP = CALL("^(time\\.Sleep|sleep)$");
const IO = CALL("^(os\\.|io\\.|http\\.|net\\.|ioutil\\.)");
const NONDETERMINISM = CALL("^(time\\.Now|rand\\.)");

const BRANCH = [
  "if_statement",
  "for_statement",
  "expression_switch_statement",
  "type_switch_statement",
  "select_statement",
];

function nameOf(node: SgNode): string | null {
  const name = fieldText(node, "name");
  return name === "" ? null : name;
}

const go: LanguageDefinition = defineLanguage({
  name: "go",
  extensions: [".go"],
  parse: (source) => parseRegistered("go", source),
  tests: (root) => root.root().findAll(TEST),
  suites: () => [],
  nameOf,
  facts(node, context) {
    const facts: Facts = { ...emptyFacts(), duplicateName: context.duplicateName };
    const skip = findAll(node, SKIP)[0];
    if (skip !== undefined) facts.skip = skip.text().slice(0, 40);

    for (const assertion of findAll(node, ASSERT)) {
      facts.assertions += 1;
      if (isUnder(assertion, node, BRANCH)) facts.nestedAssertions = true;
    }
    facts.sleeps = findAll(node, SLEEP).length;
    facts.io = findAll(node, IO).length;
    facts.nondeterminism = findAll(node, NONDETERMINISM).length;
    return facts;
  },
});

export default go;

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { extract } = await import("@test-lint/core");

  const SOURCE = `
package cart

import "testing"

func TestAppliesDiscount(t *testing.T) {
	if got := Apply(cart); got != 90 {
		t.Fatalf("got %d", got)
	}
}

func TestTable(t *testing.T) {
	for _, c := range cases {
		if !c.ok {
			t.Errorf("case %v", c)
		}
	}
}

func TestLater(t *testing.T) {
	t.Skip("blocked on #12")
}

func helper(t *testing.T) {
	t.Fatal("not a test")
}
`;

  const found = extract(SOURCE, "cart_test.go", go);

  test("finds a test by its name and nothing else", () => {
    expect(found.map((s) => s.name)).toEqual(["TestAppliesDiscount", "TestTable", "TestLater"]);
  });

  test("counts a t.Fatalf as an assertion", () => {
    expect(found[0]?.facts.assertions).toBe(1);
  });

  test("reads a t.Skip inside the body", () => {
    const later = found.find((s) => s.name === "TestLater");
    expect(later?.facts.skip).toContain("Skip");
  });

  test("marks an assertion inside an if-in-a-for as nested", () => {
    const table = found.find((s) => s.name === "TestTable");
    expect(table?.facts.nestedAssertions).toBe(true);
    expect(found[0]?.facts.nestedAssertions).toBe(true);
  });
}
