/**
 * Rust: `#[test] fn`, and the attribute that is a sibling rather than a parent.
 *
 * There is no test construct in the grammar. The attribute is a separate node
 * before the function, so the rule uses a relation (`follows`) instead of
 * searching the function's own text -- searching its text would match a
 * `#[test]` written in a doc comment on an unrelated function.
 *
 * `assert_eq!(a, b)` is a macro invocation, not a call: `kind: macro_invocation`
 * with the `macro` field is what selects it.
 */
import type { NapiConfig, SgNode } from "@ast-grep/napi";
import { defineLanguage, emptyFacts, fieldText, findAll, isUnder } from "@test-lint/core";
import type { Facts, LanguageDefinition } from "@test-lint/core";
import { parseRegistered } from "./register.ts";

const CALL = (regex: string): NapiConfig => ({
  rule: { kind: "call_expression", has: { field: "function", regex } },
});

/**
 * Every function; `hasTestAttribute` then reads the attribute block above it.
 *
 * `follows` matches the *immediately* preceding sibling, and `#[ignore]` sitting
 * between `#[test]` and `fn` is the ordinary way to disable a test -- so a rule
 * that demanded `#[test]` adjacent lost exactly those.
 */
const FUNCTION: NapiConfig = { rule: { kind: "function_item" } };

function hasTestAttribute(node: SgNode): boolean {
  for (let previous = node.prev(); previous != null; previous = previous.prev()) {
    if (String(previous.kind()) !== "attribute_item") break;
    if (/#\[.*test/.test(previous.text())) return true;
  }
  return false;
}
const ASSERT_MACRO: NapiConfig = {
  rule: {
    kind: "macro_invocation",
    has: { field: "macro", regex: "^(assert|assert_eq|assert_ne|debug_assert|panic|unreachable)" },
  },
};
const SLEEP = CALL("^(thread::sleep|sleep|tokio::time::sleep)");
const IO = CALL("^(fs::|std::fs|File::|TcpStream::|std::net|reqwest::)");
const NONDETERMINISM = CALL("^(SystemTime::now|Instant::now|rand::)");

const BRANCH = [
  "if_expression",
  "for_expression",
  "while_expression",
  "match_expression",
  "loop_expression",
];

function nameOf(node: SgNode): string | null {
  const name = fieldText(node, "name");
  return name === "" ? null : name;
}

/** `#[ignore]` sits in the attributes before the function, as `#[test]` does. */
function isSkipped(node: SgNode): string | null {
  for (let previous = node.prev(); previous != null; previous = previous.prev()) {
    const text = previous.text();
    if (String(previous.kind()) !== "attribute_item") break;
    if (/#\[.*ignore/.test(text)) return "ignore";
  }
  return null;
}

const rust: LanguageDefinition = defineLanguage({
  name: "rust",
  extensions: [".rs"],
  parse: (source) => parseRegistered("rust", source),
  tests: (root) => root.root().findAll(FUNCTION).filter(hasTestAttribute),
  suites: () => [],
  nameOf,
  facts(node, context) {
    const facts: Facts = {
      ...emptyFacts(),
      duplicateName: context.duplicateName,
      skip: isSkipped(node),
    };
    for (const assertion of findAll(node, ASSERT_MACRO)) {
      facts.assertions += 1;
      if (isUnder(assertion, node, BRANCH)) facts.nestedAssertions = true;
    }
    facts.sleeps = findAll(node, SLEEP).length;
    facts.io = findAll(node, IO).length;
    facts.nondeterminism = findAll(node, NONDETERMINISM).length;
    facts.awaits = findAll(node, { rule: { kind: "await_expression" } }).length;
    return facts;
  },
});

export default rust;

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { extract } = await import("@test-lint/core");

  const SOURCE = `
#[test]
fn applies_the_discount() {
    assert_eq!(apply(cart), 90);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn later() {
        for case in cases {
            assert!(case.ok());
        }
    }

    #[tokio::test]
    async fn waits() {
        tokio::time::sleep(d).await;
        assert!(done().await);
    }
}

fn helper() {
    // #[test] in a comment is not a test
    assert_eq!(1, 1);
}
`;

  const found = extract(SOURCE, "src/cart.rs", rust);
  const byName = (name: string) => found.find((s) => s.name === name);

  test("finds a test by the attribute above it, inside a module or not", () => {
    expect(found.map((s) => s.name)).toEqual(["applies_the_discount", "later", "waits"]);
  });

  test("counts an assert macro as an assertion", () => {
    expect(byName("applies_the_discount")?.facts.assertions).toBe(1);
    expect(byName("waits")?.facts.assertions).toBe(1);
  });

  test("reads #[ignore] and a branch around an assertion", () => {
    expect(byName("later")?.facts.skip).toBe("ignore");
    expect(byName("later")?.facts.nestedAssertions).toBe(true);
    expect(byName("applies_the_discount")?.facts.skip).toBeNull();
  });

  test("counts a sleep and an await", () => {
    expect(byName("waits")?.facts.sleeps).toBe(1);
    expect(byName("waits")?.facts.awaits).toBe(1);
  });

  test("a function with no test attribute is not a test", () => {
    expect(found.map((s) => s.name)).not.toContain("helper");
  });
}
