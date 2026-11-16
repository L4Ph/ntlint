/**
 * Loading a vocabulary, and refusing one that is wrong.
 *
 * The shape lives in `schema.ts` as a valibot schema; this file adds only what a
 * schema cannot express:
 *
 * - **A duplicate name is an error, and names both files.** A user vocabulary
 *   overriding a shipped one is deliberate and must win visibly; two
 *   vocabularies for one language is a merge nobody can reason about.
 * - **Every regex is compiled at load.** A broken pattern is a vocabulary error
 *   at the first line of output, not a crash on the first file that happens to
 *   match it.
 */
import { parse } from "yaml";
import { safeParse, type BaseIssue } from "valibot";
import { VocabSchema } from "./schema.ts";
import { VOCAB_CAPABILITIES } from "./types.ts";
import type { Capability, Vocab } from "./types.ts";

export class VocabError extends Error {
  readonly source: string;

  constructor(message: string, source: string) {
    super(`${source}: ${message}`);
    this.name = "VocabError";
    this.source = source;
  }
}

/** Read one vocabulary. Throws `VocabError` rather than returning a partial one. */
export function parseVocab(text: string, source: string): Vocab {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new VocabError(`not valid YAML: ${(error as Error).message}`, source);
  }
  const result = safeParse(VocabSchema, data);
  if (!result.success) throw new VocabError(describeIssues(result.issues), source);

  const vocab = result.output;
  compile(vocab.test.callee, "test.callee", source);
  compile(vocab.test.marker, "test.marker", source);
  compile(vocab.suite.callee, "suite.callee", source);
  for (const [i, guard] of vocab.test.guard.entries()) {
    compile(guard.condition, `test.guard[${i}].condition`, source);
    compile(guard.attribute, `test.guard[${i}].attribute`, source);
  }
  for (const key of ["assert", "double", "sleep", "hooks", "io", "nondeterminism"] as const) {
    for (const [i, predicate] of vocab[key].entries()) {
      compile(predicate.callee, `${key}[${i}].callee`, source);
    }
  }
  compile(vocab.skip.marker, "skip.marker", source);
  return { ...vocab, source };
}

function compile(pattern: string | null, where: string, source: string): void {
  if (pattern === null) return;
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new VocabError(`${where}: not a valid regex (${(error as Error).message})`, source);
  }
}

/** One line per issue, naming the key rather than the whole file. */
function describeIssues(issues: BaseIssue<unknown>[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? []).map((p) => String(p.key)).join(".");
      if (issue.type === "strict_object") return `unknown key "${path}"`;
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** What this vocabulary can be asked about, in the canonical order. */
export function derivedCapabilities(vocab: Vocab): Capability[] {
  const has = (list: unknown[]) => list.length > 0;
  const declared: Record<(typeof VOCAB_CAPABILITIES)[number], boolean> = {
    test: vocab.test.callee !== null || vocab.test.marker !== null || vocab.test.container !== null,
    assert: has(vocab.assert),
    skip: vocab.skip.marker !== null || vocab.skip.modifiers.length > 0,
    sleep: has(vocab.sleep),
    doubles: has(vocab.double),
    hooks: has(vocab.hooks),
    snapshot: has(vocab.snapshotMatchers),
    io: has(vocab.io),
    nondeterminism: has(vocab.nondeterminism),
  };
  return VOCAB_CAPABILITIES.filter((c) => declared[c]);
}

/**
 * Shipped vocabularies, with user ones laid over them by name.
 *
 * The order is the shipped order, so a report does not reshuffle when a user
 * adds a language; a user-only vocabulary is appended.
 */
export function mergeVocabs(shipped: Vocab[], user: Vocab[]): Vocab[] {
  rejectDuplicates(user, "user");
  rejectDuplicates(shipped, "shipped");
  const byName = new Map(user.map((v) => [v.name, v]));
  const merged = shipped.map((v) => byName.get(v.name) ?? v);
  const shippedNames = new Set(shipped.map((v) => v.name));
  for (const v of user) if (!shippedNames.has(v.name)) merged.push(v);
  return merged;
}

function rejectDuplicates(vocabs: Vocab[], which: string): void {
  const seen = new Map<string, Vocab>();
  for (const v of vocabs) {
    const first = seen.get(v.name);
    if (first !== undefined) {
      throw new VocabError(
        `two ${which} vocabularies for "${v.name}": ${first.source} and ${v.source}`,
        v.source,
      );
    }
    seen.set(v.name, v);
  }
}

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

  const TS = `
  name: typescript
  grammars: [TypeScript, Tsx, JavaScript, Jsx]
  test:
    callee: "^(it|test)$"
    guard:
      - { kind: if_statement, condition: '^import' }
  structure:
    loop: [for_statement]
    conditional: [if_statement]
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
    expect(vocab.test.callee).toBe("^(it|test)$");
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
}
