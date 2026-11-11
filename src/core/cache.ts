/**
 * The verdict cache: answers stored under the question that produced them.
 *
 * What is stored is the ANSWER, not the finding. That is what makes
 * recalibration free: a cutoff is applied by `gate.ts` after the fact, so
 * changing one invalidates nothing.
 *
 * Every component of the key is load-bearing:
 *
 * - `ruleTextHash` -- editing the sentence is editing the question. The
 *   criteria are in it too, because the model reads them.
 * - `factsHash` -- what the vocabulary extracted. Without it, fixing a
 *   vocabulary keeps serving verdicts formed from the old, wrong facts.
 * - `arm` -- the same subject at another arm was shown different evidence.
 * - `subjectText` -- not the line number, which moves for free.
 *
 * `threshold` is deliberately absent. Adding it would make every recalibration
 * a cache flush, and a flush is how a run stops being comparable with the last.
 */
import { createHash } from "node:crypto";
import type { Answer, Facts, Rule, TestSubject } from "./types.ts";

/** Changing the payload shape is a cache flush, and that is the intent. */
export const SCHEMA = "test-lint-verdict-1";

export function verdictKey(input: { rule: Rule; subject: TestSubject; arm: string }): string {
  const { rule, subject, arm } = input;
  return hash([SCHEMA, rule.id, ruleTextHash(rule), factsHash(subject.facts), arm, subject.text]);
}

/** Everything about a rule the model is shown, and nothing else. */
export function ruleTextHash(rule: Rule): string {
  return hash([rule.ask, canonicalJson(rule.levels), canonicalJson(rule.criteria)]);
}

export function factsHash(facts: Facts): string {
  return hash([canonicalJson(facts)]);
}

/**
 * JSON with object keys sorted, so re-spelling a matcher or a fact is not a new
 * draft. Arrays keep their order: the order of `importedFrom` is meaningless,
 * but the order of a rule's levels is the scale.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/** A cache file's contents: the key is the answer's whole identity. */
export type CacheEntries = Record<string, Answer>;

export class Cache {
  private readonly entries: Map<string, Answer>;

  constructor(entries: CacheEntries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  get(key: string): Answer | null {
    return this.entries.get(key) ?? null;
  }

  set(key: string, answer: Answer): void {
    this.entries.set(key, answer);
  }

  get size(): number {
    return this.entries.size;
  }

  toJSON(): CacheEntries {
    return Object.fromEntries(this.entries);
  }
}
