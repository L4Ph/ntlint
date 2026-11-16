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
export { defineLanguage, emptyFacts, extract } from "./language.ts";
export type { LanguageDefinition } from "./language.ts";
export type { Question } from "./question.ts";
export { defineRule, loadRules, severityOf, validateRule } from "./rules.ts";
export type { LoadOptions, LoadedRules, SkippedRule } from "./rules.ts";
export { formatGithub, formatJson, formatPretty } from "./report.ts";
export {
  classify,
  JevClient,
  JevError,
  readAnswer,
  takeKeyFromEnv,
  USD_PER_MTOK,
} from "./client.ts";
export type {
  AskClient,
  AskRequest,
  AskResponse,
  JevErrorKind,
  JevOptions,
  Spend,
} from "./client.ts";
export { estimateTokens, usdFor } from "./estimate.ts";
export { run } from "./run.ts";
export type { RunOptions, RunResult, RunSpend } from "./run.ts";
