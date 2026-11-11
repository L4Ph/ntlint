import { expect, test } from "vite-plus/test";
import { VocabError, derivedCapabilities, mergeVocabs, parseVocab } from "../src/core/vocab.ts";

const TS = `
name: typescript
grammars: [TypeScript, Tsx, JavaScript, Jsx]
test:
  utils: [test-call]
  guard:
    - { kind: if_statement, condition: '^import' }
structure:
  loop: [for_statement]
  conditional: [if_statement]
  try: [try_statement]
  call: [call_expression]
assert:
  - { callee: "^expect$", importedFrom: [vitest, import.meta.vitest] }
sleep:
  - { callee: "^setTimeout$" }
`;

test("a vocabulary names the grammars it covers and how a test is found", () => {
  const vocab = parseVocab(TS, "shipped/typescript.yml");
  expect(vocab.name).toBe("typescript");
  expect(vocab.grammars).toEqual(["TypeScript", "Tsx", "JavaScript", "Jsx"]);
  expect(vocab.test.utils).toEqual(["test-call"]);
  expect(vocab.assert).toHaveLength(1);
});

test("an unknown key is rejected by name, so a typo cannot quietly do nothing", () => {
  const typo = TS.replace("assert:", "assesrt:");
  // The message has to name the key: "invalid vocabulary" sends the author
  // looking through the whole file, and naming it sends them to the line.
  expect(() => parseVocab(typo, "typescript.yml")).toThrow(/assesrt/);
  expect(() => parseVocab(typo, "typescript.yml")).toThrow(VocabError);
});

test("capabilities come from what the vocabulary declares, not from a language list", () => {
  // A rule asking for `doubles` must not run here: this vocabulary declares no
  // doubles at all, and a rule that ran anyway would report every test as
  // clean of a defect it cannot see.
  const caps = derivedCapabilities(parseVocab(TS, "typescript.yml"));
  expect(caps).toContain("sleep");
  expect(caps).not.toContain("doubles");
  expect(caps).not.toContain("snapshot");
});

test("a user vocabulary replaces the shipped one for the same language", () => {
  const shipped = parseVocab(TS, "shipped/typescript.yml");
  const user = parseVocab(
    TS.replace("name: typescript", "name: typescript").replace("^setTimeout$", "^waitFor$"),
    ".test-lint/vocab/typescript.yml",
  );
  const merged = mergeVocabs([shipped], [user]);
  expect(merged).toHaveLength(1);
  // The override has to win visibly: a silently shadowed vocabulary looks
  // exactly like one that is not being read.
  expect(merged[0]!.source).toBe(".test-lint/vocab/typescript.yml");
  expect(merged[0]!.sleep?.[0]?.callee).toBe("^waitFor$");
});

test("two vocabularies at the same level are an error, naming both sources", () => {
  // Across levels (shipped vs user) an override is deliberate and wins; at one
  // level there is no rule that could pick between them, so the loader refuses.
  const a = parseVocab(TS, "one/typescript.yml");
  const b = parseVocab(TS, "two/typescript.yml");
  expect(() => mergeVocabs([a, b], [])).toThrow(/typescript/);
  expect(() => mergeVocabs([a, b], [])).toThrow(/one\/typescript.yml/);
  expect(() => mergeVocabs([], [a, b])).toThrow(/two\/typescript.yml/);
});
