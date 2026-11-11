/**
 * A token estimate, generously padded.
 *
 * Its job is not to be accurate but to keep a request under the server's limit
 * and to price a `--dry-run` in the right order of magnitude. jev-lint measured
 * 3.37 characters per token for prose and 2.18 for structural text and padded
 * both, which overstated a real bill by 22% -- so the constants here are
 * deliberately low and the padding is explicit.
 */
const CHARS_PER_TOKEN_TEXT = 3.4;
const CHARS_PER_TOKEN_STRUCT = 2.2;
const PROSE_LENGTH = 64;

/** An estimate in tokens for a serialized request body. */
export function estimateTokens(body: string): number {
  // Cheap shape heuristic: a body full of short keys and punctuation costs more
  // tokens per character than one full of prose.
  const ratio = body.length > PROSE_LENGTH * 8 ? CHARS_PER_TOKEN_STRUCT : CHARS_PER_TOKEN_TEXT;
  return Math.ceil(body.length / ratio);
}

/** What a run would cost, in USD, at the published input price. */
export function usdFor(tokens: number, perMtok: number): number {
  return (tokens / 1_000_000) * perMtok;
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

  test("an estimate grows with the body", () => {
    expect(estimateTokens("x".repeat(1000))).toBeGreaterThan(estimateTokens("x".repeat(100)));
  });

  test("a price is linear in tokens, so a dry run can quote one", () => {
    expect(usdFor(1_000_000, 0.042)).toBeCloseTo(0.042);
    expect(usdFor(500_000, 0.042)).toBeCloseTo(0.021);
  });
}
