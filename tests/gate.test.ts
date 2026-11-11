import { expect, test } from "vite-plus/test";
import { blocks, collect, decide } from "../src/core/gate.ts";
import { answer, rule, subject } from "./builders.ts";

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
  expect(blocks([decide(rule({ severity: "error" }), subject(), answer(0.9))], "error")).toBe(true);
});

test("a rule whose answer is unusable for it does not report one", () => {
  // `require` is the postcondition the rule author sets: an answer that fails it
  // is "we asked and could not decide", which is counted and never shown.
  const r = rule({ require: (a) => (a.confidence ?? 0) >= 0.4 });
  const finding = decide(r, subject(), answer(0.9, { confidence: 0.2 }));
  expect(finding.reported).toBe(false);
  expect(finding.messageId).toBe("unsure");
});
