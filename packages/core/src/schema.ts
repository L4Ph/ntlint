/**
 * What the endpoint answers, validated rather than duck-typed.
 *
 * An answer outside 0..1, or of a type this build does not know, must reach the
 * gate as `missing`: a value read loosely is a verdict nobody can defend.
 *
 * The envelope is not strict, because the server may add fields this build has
 * no opinion about; each answer is, because an answer is the thing being
 * believed.
 */
import * as v from "valibot";

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

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

  test("an answer outside 0..1 is refused rather than reported as a verdict", () => {
    expect(v.safeParse(AnswerSchema, { type: "noul", noul: 1.4 }).success).toBe(false);
    expect(v.safeParse(AnswerSchema, { type: "noul", noul: 0.4 }).success).toBe(true);
  });

  test("an answer of an unknown type is refused", () => {
    expect(v.safeParse(AnswerSchema, { type: "choice", choice: "a" }).success).toBe(false);
  });

  test("a response missing usage still reads, with the counts at zero", () => {
    // `parse` throws, so the assertion is not guarded by a branch it would be
    // skipped in -- which is what a `if (result.success)` wrapper was doing.
    const parsed = v.parse(AskResponseSchema, { answers: {} });
    expect(parsed.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  test("a response with a field this build does not know still reads", () => {
    // The server may add fields; the envelope must not reject them.
    expect(v.safeParse(AskResponseSchema, { answers: {}, model: "jev-1.13.0" }).success).toBe(true);
  });
}
