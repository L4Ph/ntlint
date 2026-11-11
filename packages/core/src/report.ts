/**
 * Three shapes for the same findings, and nothing else.
 *
 * Every line names the rule, so an agent can look up what it means, and the
 * numbers are printed as they were decided rather than re-derived here. The
 * counts come from the same `collect` the gate ran, so a report cannot disagree
 * with the exit code.
 */
import type { Finding } from "./types.ts";
import type { RunResult } from "./run.ts";

/** Machine-readable, and the only shape that carries `subjectSource`. */
export function formatJson(result: RunResult): string {
  return JSON.stringify(
    {
      findings: result.findings.map((f) => ({
        ruleId: f.ruleId,
        file: f.file,
        line: f.line,
        endLine: f.endLine,
        severity: f.severity,
        messageId: f.messageId,
        value: f.value,
        confidence: f.confidence,
        at: f.at,
        subjectSource: f.subjectSource,
      })),
      stats: result.stats,
      spend: result.spend,
      cached: result.cached,
      failures: result.failures,
    },
    null,
    2,
  );
}

/** GitHub annotations: one command per finding, on the line that produced it. */
export function formatGithub(result: RunResult): string {
  return result.findings
    .map((f) => {
      const level = f.severity === "error" ? "error" : "warning";
      const title = escape(`${f.ruleId}${f.messageId === "candidate" ? " (candidate)" : ""}`);
      return `::${level} file=${f.file},line=${f.line},title=${title}::${escape(describe(f))}`;
    })
    .join("\n");
}

/** For a terminal: what, where, and how far over its own cutoff. */
export function formatPretty(result: RunResult): string {
  const lines = result.findings.map(
    (f) =>
      `${f.file}:${f.line}  ${f.ruleId}  ${number(f)}  cutoff ${f.at.toFixed(2)}  ${describe(f)}`,
  );
  const { subjects, reported, missing, unsure, candidates } = result.stats;
  lines.push(
    `${subjects} judged, ${reported} reported (${candidates} candidate, ${unsure} unsure), ${missing} without a verdict`,
  );
  if (result.failures.length > 0) lines.push(`${result.failures.length} request(s) failed`);
  return lines.join("\n");
}

function describe(finding: Finding): string {
  if (finding.value === null)
    return "no verdict: the request failed or returned an unusable answer";
  if (finding.messageId === "candidate") return "candidate: over the cutoff, not a fitted one";
  if (finding.messageId === "unsure") return "asked, could not decide";
  return "over its cutoff";
}

function number(finding: Finding): string {
  return finding.value === null ? "   -  " : finding.value.toFixed(2);
}

function escape(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { answer, rule, subject } = await import("./testing/builders.ts");
  const { collect, decide } = await import("./gate.ts");
  const base = {
    spend: { requests: 1, inputTokens: 10, usd: 0 },
    cached: 0,
    failures: [],
  };

  const result = (findings: ReturnType<typeof decide>[]) => ({ ...collect(findings), ...base });

  test("json carries what an agent acts on, and no prose", () => {
    const r = result([decide(rule({ calibration: "fitted" }), subject(), answer(0.9))]);
    const parsed = JSON.parse(formatJson(r)) as { findings: Array<Record<string, unknown>> };
    expect(parsed.findings[0]).toMatchObject({
      ruleId: "test-name-verifies-claim",
      file: "src/discount.test.ts",
      line: 3,
      subjectSource: "test",
      at: 0.5,
      value: 0.9,
    });
    expect(parsed.findings[0]).not.toHaveProperty("message");
  });

  test("a candidate is annotated as one, so nobody fixes it as a verdict", () => {
    const r = result([
      decide(rule({ calibration: "borrowed", calibrationSource: "x" }), subject(), answer(0.9)),
    ]);
    expect(formatGithub(r)).toContain("(candidate)");
    expect(formatGithub(r)).toContain("::warning file=src/discount.test.ts,line=3");
  });

  test("a missing verdict is counted in the summary, not hidden", () => {
    const r = result([decide(rule(), subject(), null)]);
    expect(formatPretty(r)).toContain("1 without a verdict");
    expect(formatJson(r)).toContain('"missing": 1');
  });

  test("a newline in a title cannot break a GitHub annotation", () => {
    const r = result([decide(rule({ id: "x", calibration: "fitted" }), subject(), answer(0.9))]);
    expect(formatGithub(r).split("\n")).toHaveLength(1);
  });
}
