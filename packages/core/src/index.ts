/**
 * The core the rules are written against.
 *
 * Everything here is deterministic and offline. Reaching the model happens
 * through `ctx.judge` in the runner, not from this package, so a rule can be
 * tested without a key and a recorded run can be re-gated without a request.
 */
export * from "./types.ts";
export { Cache, canonicalJson, factsHash, ruleTextHash, SCHEMA, verdictKey } from "./cache.ts";
export type { CacheEntries } from "./cache.ts";
export { blocks, collect, decide } from "./gate.ts";
export type { GateResult, GateStats } from "./gate.ts";
export { buildQuestion, questionId, substitute } from "./question.ts";
export type { Question } from "./question.ts";
export { defineRule, loadRules, severityOf, validateRule } from "./rules.ts";
export type { LoadOptions, LoadedRules, SkippedRule } from "./rules.ts";
export { derivedCapabilities, mergeVocabs, parseVocab, VocabError } from "./vocab.ts";
