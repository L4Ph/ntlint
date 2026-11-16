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
import { answer, rule, subject } from "./testing/builders.ts";

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
    subject: subject.name,
    docs: rule.docs,
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

  // Only a cutoff fitted on this corpus can produce a violation. A borrowed one
  // answered a question measured somewhere else, and a placeholder was never
  // measured at all; both run, both are useful, and neither turns an exit code.
  if (rule.calibration !== "fitted") {
    return { ...decided, messageId: "candidate", reported: true };
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

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

  test("an answer at its own cutoff is reported", () => {
    const finding = decide(rule({ threshold: 0.5 }), subject(), answer(0.5));
    expect(finding.reported).toBe(true);
    expect(finding.messageId).toBe("violation");
    expect(finding.margin).toBe(1);
  });

  test("an answer under its cutoff is not reported", () => {
    const finding = decide(rule({ threshold: 0.5 }), subject(), answer(0.49));
    expect(finding.reported).toBe(false);
    expect(finding.messageId).toBeNull();
  });

  test("a weak claim is reported as a candidate rather than a violation", () => {
    // The answer is over the cutoff, so it is a finding; the rule says the claim
    // is a weak one, so an agent reads it as something to check rather than fix.
    const r = rule({ candidate: (a) => a.value < 0.8 });
    const finding = decide(r, subject(), answer(0.6));
    expect(finding.messageId).toBe("candidate");
    expect(finding.reported).toBe(true);
  });

  test("a missing answer is never reported, and the run still counts it", () => {
    // A run where half the requests failed must not read as a clean repository.
    const finding = decide(rule(), subject(), null);
    expect(finding.reported).toBe(false);
    expect(finding.messageId).toBe("missing");

    const result = collect([
      decide(rule(), subject(), null),
      decide(rule(), subject({ file: "src/b.ts", line: 9 }), answer(0.9)),
    ]);
    expect(result.stats.missing).toBe(1);
    expect(result.stats.reported).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  test("a warning does not block a gate set to error", () => {
    // A pre-commit hook that a probabilistic reviewer can refuse on a warning is
    // a hook that gets uninstalled.
    const findings = [decide(rule({ severity: "warning" }), subject(), answer(0.9))];
    expect(blocks(findings, null)).toBe(true);
    expect(blocks(findings, "error")).toBe(false);
    expect(blocks([decide(rule({ severity: "error" }), subject(), answer(0.9))], "error")).toBe(
      true,
    );
  });

  test("a borrowed cutoff reports a candidate, never a violation", () => {
    // The cutoff was measured on another corpus, against the same question. It
    // is evidence; it is not this repository's own number.
    const borrowed = rule({ calibration: "borrowed", calibrationSource: "jev-lint@af58a3b" });
    const finding = decide(borrowed, subject(), answer(0.99));
    expect(finding.messageId).toBe("candidate");
    expect(blocks([finding], null)).toBe(false);
  });

  test("a placeholder cutoff reports a candidate, never a violation", () => {
    const placeholder = rule({ calibration: "placeholder", calibrationSource: null });
    expect(decide(placeholder, subject(), answer(0.99)).messageId).toBe("candidate");
  });

  test("only a cutoff fitted here can turn an exit code", () => {
    const fitted = rule({ calibration: "fitted" });
    expect(blocks([decide(fitted, subject(), answer(0.99))], null)).toBe(true);
  });

  test("a rule whose answer is unusable for it does not report one", () => {
    // `require` is the postcondition the rule author sets: an answer that fails it
    // is "we asked and could not decide", which is counted and never shown.
    const r = rule({ require: (a) => (a.confidence ?? 0) >= 0.4 });
    const finding = decide(r, subject(), answer(0.9, { confidence: 0.2 }));
    expect(finding.reported).toBe(false);
    expect(finding.messageId).toBe("unsure");
  });
}
