/**
 * The vocabulary's shape, in one place.
 *
 * The schema is the source: `Vocab` is inferred from it, the loader validates
 * with it, and `vocab/schema.json` is emitted from it so an editor validates the
 * YAML while it is being written. The hand-written validators this replaces had
 * a second copy of every rule and could drift from the type; there is nothing to
 * drift from now.
 *
 * `strictObject` is deliberate everywhere. A misspelt `assesrt:` that loads
 * silently means every test in that language is judged as though it never
 * asserted anything, and the error names the key because "invalid vocabulary"
 * sends the author through the whole file.
 */
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";

const regex = v.string();
const strings = v.optional(v.array(v.string()), []);

export const PredicateSchema = v.strictObject({
  shape: v.optional(v.picklist(["call", "method", "macro", "statement"]), "call"),
  callee: v.optional(v.nullable(regex), null),
  keyword: v.optional(v.nullable(v.string()), null),
  importedFrom: strings,
});

export const GuardSchema = v.strictObject({
  kind: v.pipe(v.string(), v.minLength(1)),
  condition: v.optional(v.nullable(regex), null),
  attribute: v.optional(v.nullable(regex), null),
});

export const TestSchema = v.pipe(
  v.strictObject({
    callee: v.optional(v.nullable(regex), null),
    marker: v.optional(v.nullable(regex), null),
    container: v.optional(v.nullable(v.string()), null),
    guard: v.optional(v.array(GuardSchema), []),
  }),
  v.check(
    (test) => test.callee !== null || test.marker !== null || test.container !== null,
    "a test needs one of callee, marker or container, or nothing can be found",
  ),
);

export const SuiteSchema = v.strictObject({
  callee: v.optional(v.nullable(regex), null),
});

export const StructureSchema = v.strictObject({
  loop: strings,
  conditional: strings,
  try: strings,
  call: strings,
});

export const SkipSchema = v.strictObject({
  marker: v.optional(v.nullable(regex), null),
  modifiers: strings,
});

export const VocabSchema = v.strictObject({
  name: v.pipe(v.string(), v.minLength(1)),
  grammars: v.pipe(v.array(v.string()), v.minLength(1)),
  test: TestSchema,
  suite: v.optional(SuiteSchema, { callee: null }),
  structure: v.optional(StructureSchema, { loop: [], conditional: [], try: [], call: [] }),
  assert: v.optional(v.array(PredicateSchema), []),
  double: v.optional(v.array(PredicateSchema), []),
  sleep: v.optional(v.array(PredicateSchema), []),
  skip: v.optional(SkipSchema, { marker: null, modifiers: [] }),
  hooks: v.optional(v.array(PredicateSchema), []),
  interactionMatchers: strings,
  snapshotMatchers: strings,
  io: v.optional(v.array(PredicateSchema), []),
  nondeterminism: v.optional(v.array(PredicateSchema), []),
  async: v.optional(v.boolean(), false),
});

/** What a vocabulary file says. The loader adds `source`. */
export type VocabFile = v.InferOutput<typeof VocabSchema>;
export type Vocab = VocabFile & { source: string };
export type Predicate = v.InferOutput<typeof PredicateSchema>;
export type Guard = v.InferOutput<typeof GuardSchema>;
export type VocabTest = VocabFile["test"];
export type VocabSuite = VocabFile["suite"];
export type VocabStructure = VocabFile["structure"];
export type VocabSkip = VocabFile["skip"];

/**
 * What the endpoint answers. Validated rather than duck-typed: an answer that
 * does not have this shape must reach the gate as `missing`, never as a value.
 */
export const AnswerSchema = v.variant("type", [
  v.strictObject({
    type: v.literal("noul"),
    noul: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  }),
  v.strictObject({
    type: v.literal("score"),
    score: v.number(),
    confidence: v.optional(v.nullable(v.number()), null),
  }),
]);

export const AskResponseSchema = v.object({
  answers: v.optional(v.record(v.string(), v.unknown()), {}),
  usage: v.optional(
    v.strictObject({
      input_tokens: v.optional(v.number(), 0),
      output_tokens: v.optional(v.number(), 0),
    }),
    { input_tokens: 0, output_tokens: 0 },
  ),
});

/** The JSON Schema an editor uses, kept beside the vocabulary files. */
export function vocabJsonSchema(): unknown {
  return toJsonSchema(VocabSchema, { errorMode: "ignore" });
}

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

  test("a misspelt key is refused, and the error names the key", () => {
    const result = v.safeParse(VocabSchema, {
      name: "typescript",
      grammars: ["TypeScript"],
      test: { callee: "^it$" },
      assesrt: [{ callee: "^expect$" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.issues[0]!;
      expect(issue.type).toBe("strict_object");
      expect(issue.path?.map((p) => p.key)).toContain("assesrt");
    }
  });

  test("defaults are applied, so a rule never reads an undefined field", () => {
    const result = v.safeParse(VocabSchema, {
      name: "python",
      grammars: ["Python"],
      test: { marker: "^def test_" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.skip).toEqual({ marker: null, modifiers: [] });
      expect(result.output.structure.loop).toEqual([]);
      expect(result.output.suite.callee).toBeNull();
      expect(result.output.assert).toEqual([]);
    }
  });

  test("a test with nothing that can find it is refused", () => {
    const result = v.safeParse(VocabSchema, { name: "x", grammars: ["Rust"], test: {} });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.message).toMatch(/callee, marker or container/);
  });

  test("the emitted JSON Schema forbids unknown keys and requires the name", () => {
    // The editor reads this file, so it has to say what the loader enforces.
    const schema = vocabJsonSchema() as {
      additionalProperties?: boolean;
      required?: string[];
      $schema?: string;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("name");
    expect(schema.$schema).toContain("json-schema.org");
  });

  test("the committed schema.json is what this schema emits", async () => {
    // An editor validating with a stale schema is worse than no schema, so the
    // artifact is checked rather than trusted: `node scripts/emit-schema.ts`.
    const { readFileSync } = await import("node:fs");
    const committed = JSON.parse(
      readFileSync(new URL("../vocab/schema.json", import.meta.url), "utf-8"),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(vocabJsonSchema())));
  });

  test("an answer outside 0..1 is refused rather than reported as a verdict", () => {
    expect(v.safeParse(AnswerSchema, { type: "noul", noul: 1.4 }).success).toBe(false);
    expect(v.safeParse(AnswerSchema, { type: "noul", noul: 0.4 }).success).toBe(true);
  });

  test("a response missing usage still reads, with the counts at zero", () => {
    const result = v.safeParse(AskResponseSchema, { answers: {} });
    expect(result.success).toBe(true);
    if (result.success) expect(result.output.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
}
