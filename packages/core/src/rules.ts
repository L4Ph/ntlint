/**
 * Loading rules, and refusing the ones that are not rules yet.
 *
 * Validation never throws at the caller: a bad rule is dropped with a reason,
 * because a rule that silently failed to load looks exactly like a rule that
 * found nothing. The same argument is why an unknown field is an error and why
 * an uncalibrated cutoff has to be asked for by name: a number presented as
 * fitted, and fitted to nothing, is worse than no rule at all.
 */
import { CALIBRATIONS, CAPABILITIES, RULE_SUBJECTS, SEVERITIES } from "./types.ts";
import type { Capability, Rule, Severity } from "./types.ts";

export class RuleError extends Error {
  readonly id: string;
  readonly reasons: string[];

  constructor(id: string, reasons: string[]) {
    super(`${id}: ${reasons.join("; ")}`);
    this.name = "RuleError";
    this.id = id;
    this.reasons = reasons;
  }
}

/** Authoring helper: keeps the literal's type checked without losing its shape. */
export function defineRule(rule: Rule): Rule {
  return rule;
}

export interface SkippedRule {
  id: string;
  reason: string;
}

export interface LoadOptions {
  /** What the loaded vocabularies can be asked about. */
  capabilities: ReadonlySet<Capability>;
  /** `--deterministic`: refuse anything that could make a run irreproducible. */
  deterministic: boolean;
  /** `--fitted-only`: drop every rule whose cutoff was not measured here. */
  fittedOnly: boolean;
}

export interface LoadedRules {
  rules: Rule[];
  skipped: SkippedRule[];
  errors: RuleError[];
}

/** The capabilities a run can never provide and must not silently assume. */
const FOREIGN: readonly Capability[] = ["model", "clock", "random"];

export function loadRules(defs: readonly Rule[], options: LoadOptions): LoadedRules {
  const rules: Rule[] = [];
  const skipped: SkippedRule[] = [];
  const errors: RuleError[] = [];

  for (const def of defs) {
    const reasons = validateRule(def);
    if (reasons.length > 0) {
      errors.push(new RuleError(def.id, reasons));
      continue;
    }

    if (options.deterministic) {
      const foreign = def.requires.filter((c) => FOREIGN.includes(c));
      if (foreign.length > 0) {
        skipped.push({
          id: def.id,
          reason: `--deterministic refuses a rule that needs ${foreign.join(", ")}`,
        });
        continue;
      }
    }

    const missing = def.requires.filter(
      (c) => !FOREIGN.includes(c) && !options.capabilities.has(c),
    );
    if (missing.length > 0) {
      skipped.push({
        id: def.id,
        reason: `the loaded vocabularies declare no ${missing.join(", ")}`,
      });
      continue;
    }

    if (def.calibration !== "fitted" && options.fittedOnly) {
      skipped.push({
        id: def.id,
        reason: `cutoff is ${def.calibration}, not fitted here; --fitted-only drops it`,
      });
      continue;
    }

    rules.push(def);
  }

  return { rules, skipped, errors };
}

/** Every reason this rule cannot be loaded. Empty means it can. */
export function validateRule(rule: Rule): string[] {
  const reasons: string[] = [];

  if (!/^[a-z][a-z0-9-]*$/.test(rule.id)) reasons.push(`id "${rule.id}" is not lowercase-kebab`);
  // A URL or a path inside this repository. A URL would have to name a host the
  // project has not chosen yet; a path is checkable today and resolvable by the
  // agent reading the same checkout.
  if (rule.docs.trim() === "")
    reasons.push("docs is required: a finding an agent cannot look up is a guess");
  else if (!/^https?:\/\//.test(rule.docs) && !rule.docs.endsWith(".md")) {
    reasons.push("docs must be a URL or a path ending in .md");
  }
  if (!(CALIBRATIONS as readonly string[]).includes(rule.calibration)) {
    reasons.push(`calibration "${rule.calibration}" is not one of ${CALIBRATIONS.join(", ")}`);
  }
  if (rule.calibration === "borrowed" && (rule.calibrationSource ?? "").trim() === "") {
    reasons.push("a borrowed cutoff must name where it came from");
  }
  if (!(RULE_SUBJECTS as readonly string[]).includes(rule.subject)) {
    reasons.push(`subject "${rule.subject}" is not one of ${RULE_SUBJECTS.join(", ")}`);
  }
  if (!(SEVERITIES as readonly string[]).includes(rule.severity)) {
    reasons.push(`severity "${rule.severity}" is not one of ${SEVERITIES.join(", ")}`);
  }
  if (rule.ask.trim() === "") reasons.push("ask is required");
  if (!Number.isFinite(rule.threshold) || rule.threshold <= 0 || rule.threshold > 1) {
    reasons.push(`threshold ${rule.threshold} is not in (0, 1]`);
  }
  for (const c of rule.requires) {
    if (!(CAPABILITIES as readonly string[]).includes(c)) reasons.push(`unknown capability "${c}"`);
  }

  if (rule.kind === "noul") {
    if (rule.criteria === null) reasons.push("a noul needs criteria for both branches");
    else {
      if (rule.criteria.true.trim() === "") reasons.push("criteria.true is empty");
      if (rule.criteria.false.trim() === "") reasons.push("criteria.false is empty");
    }
    if (rule.levels !== null) reasons.push("a noul has no ordered levels; use kind: score");
  } else {
    if (rule.levels === null || Object.keys(rule.levels).length < 2) {
      reasons.push("a score needs at least two levels");
    }
    if (rule.criteria !== null) reasons.push("a score has levels rather than criteria");
  }

  return reasons;
}

/** The severity a run reports for a rule, narrowed for callers that need it typed. */
export function severityOf(rule: Rule): Severity {
  return rule.severity;
}
