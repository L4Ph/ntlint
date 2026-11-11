/**
 * Answers in, findings out. Pure, and offline.
 *
 * The separation is the point: verdicts cost money, thresholds are what you
 * change twenty times while calibrating, so re-gating a recorded run is free.
 *
 * Three rules, each a measured result rather than a preference:
 *
 * 1. **A cutoff is per rule.** Same-shaped questions answer their own defect
 *    class anywhere between 0.20 and 0.94, so one shared threshold discards the
 *    rules that answer quietly.
 * 2. **A failed request is not a passing grade.** No answer becomes
 *    `messageId: "missing"` and is counted, because a run where half the
 *    requests failed must not look like a clean repository.
 * 3. **A candidate is not a violation.** It is over its cutoff and the rule
 *    says the claim is weak; it is reported for a reader and never blocks.
 */
import type { Answer, Finding, MessageId, Rule, Severity, TestSubject } from "./types.ts";
import { SEVERITIES } from "./types.ts";

export interface GateStats {
  subjects: number;
  reported: number;
  missing: number;
  unsure: number;
  candidates: number;
}

export interface GateResult {
  findings: Finding[];
  stats: GateStats;
}

/** Decide one subject. Always returns a finding, whose `reported` says whether anyone should see it. */
export function decide(rule: Rule, subject: TestSubject, answer: Answer | null): Finding {
  const at = rule.threshold;
  const base = {
    ruleId: rule.id,
    file: subject.file,
    line: subject.line,
    endLine: subject.endLine,
    severity: rule.severity,
    at,
    subjectSource: subject.subjectSource,
  } as const;

  if (!answer) {
    return {
      ...base,
      messageId: "missing",
      reported: false,
      value: null,
      confidence: null,
      margin: null,
    };
  }

  const margin = at > 0 ? answer.value / at : answer.value;
  const decided = {
    ...base,
    value: answer.value,
    confidence: answer.confidence,
    margin,
  } as const;

  if (answer.value < at) {
    return { ...decided, messageId: null, reported: false };
  }

  // Over the cutoff, but the rule cannot use this answer: it is "we asked and
  // could not decide", which is counted and never shown.
  if (rule.require !== null && !rule.require(answer)) {
    return { ...decided, messageId: "unsure", reported: false };
  }

  if (rule.candidate !== null && rule.candidate(answer)) {
    return { ...decided, messageId: "candidate", reported: true };
  }

  return { ...decided, messageId: "violation", reported: true };
}

/** Decide a whole run, and derive the counts the report prints from the findings. */
export function collect(all: Finding[]): GateResult {
  const findings = all.filter((f) => f.reported).sort(byMargin);
  return {
    findings,
    stats: {
      subjects: all.length,
      reported: findings.length,
      missing: all.filter((f) => f.messageId === "missing").length,
      unsure: all.filter((f) => f.messageId === "unsure").length,
      candidates: all.filter((f) => f.messageId === "candidate").length,
    },
  };
}

/**
 * Which findings turn the exit code.
 *
 * A candidate never does: it exists so a reader can decide, and a probabilistic
 * reviewer that can refuse a commit on one is one that gets uninstalled.
 */
export function blocks(findings: Finding[], failOn: Severity | null): boolean {
  const violations = findings.filter((f) => f.messageId === "violation");
  if (failOn === null) return violations.length > 0;
  const floor = SEVERITIES.indexOf(failOn);
  return violations.some((f) => SEVERITIES.indexOf(f.severity) >= floor);
}

/** Margin is `value / cutoff`, so findings from rules with different scales rank together. */
function byMargin(a: Finding, b: Finding): number {
  return (b.margin ?? 0) - (a.margin ?? 0) || a.file.localeCompare(b.file) || a.line - b.line;
}

/** The message id a finding carries, for a caller that only has the finding. */
export function messageIdOf(finding: Finding): MessageId | null {
  return finding.messageId;
}
