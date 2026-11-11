/**
 * The rules that ship.
 *
 * Two of jev-lint's test rules are deliberately not here, because neither fits
 * a subject that is one test: `tests-cover-failure-paths` pairs a function with
 * the tests that reach it, and `describe-names-subject` judges a suite against
 * the tests inside it. Both need a subject shape v0.1 does not have, and
 * shipping them as if they were test rules would judge the wrong thing.
 */
import testNameDescribesCode from "./test-name-describes-code.ts";
import snapshotOnlyBehaviourClaim from "./snapshot-only-behaviour-claim.ts";
import testAssertsSomething from "./test-asserts-something.ts";
import testAssertsTheOutcome from "./test-asserts-the-outcome.ts";
import testIsNotAbandoned from "./test-is-not-abandoned.ts";
import testMocksSubject from "./test-mocks-subject.ts";
import testNameIsASpecification from "./test-name-is-a-specification.ts";
import testNameVerifiesClaim from "./test-name-verifies-claim.ts";
import testStructureIsFlat from "./test-structure-is-flat.ts";
import testWaitsForTheEvent from "./test-waits-for-the-event.ts";
import { loadRules, validateRule } from "@test-lint/core";
import { rule } from "@test-lint/core/testing";
import type { Capability, Rule } from "@test-lint/core";

export const BUILTIN_RULES: readonly Rule[] = [
  testNameDescribesCode,
  testNameVerifiesClaim,
  testMocksSubject,
  snapshotOnlyBehaviourClaim,
  testAssertsSomething,
  testIsNotAbandoned,
  testWaitsForTheEvent,
  testStructureIsFlat,
  testAssertsTheOutcome,
  testNameIsASpecification,
];

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;

  const ALL: ReadonlySet<Capability> = new Set<Capability>([
    "model",
    "test",
    "assert",
    "skip",
    "sleep",
    "doubles",
    "hooks",
    "snapshot",
    "async",
  ]);

  const load = (defs = BUILTIN_RULES, overrides: Partial<Parameters<typeof loadRules>[1]> = {}) =>
    loadRules(defs, {
      capabilities: ALL,
      deterministic: false,
      strictCalibration: false,
      ...overrides,
    });

  test("a rule without docs is an error naming the field", () => {
    // A finding an agent cannot look up is a finding it has to guess about.
    const broken = rule({ docs: "" });
    expect(validateRule(broken).join(" ")).toMatch(/docs/);
    const result = load([broken]);
    expect(result.rules).toHaveLength(0);
    expect(result.errors[0]?.id).toBe("test-name-verifies-claim");
  });

  test("a rule that needs doubles is skipped when no vocabulary declares them, and says why", () => {
    // Running it anyway would report every test as clean of a defect it cannot see.
    const withoutDoubles = new Set<Capability>([...ALL].filter((c) => c !== "doubles"));
    const result = load(BUILTIN_RULES, { capabilities: withoutDoubles });
    expect(result.rules.map((r) => r.id)).not.toContain("test-mocks-subject");
    expect(result.skipped.find((s) => s.id === "test-mocks-subject")?.reason).toMatch(/doubles/);
  });

  test("under --deterministic a rule that needs the model never runs", () => {
    const result = load(BUILTIN_RULES, { deterministic: true });
    expect(result.rules).toHaveLength(0);
    expect(result.skipped.every((s) => /--deterministic/.test(s.reason))).toBe(true);
  });

  test("a strict run drops an uncalibrated rule, and says why", () => {
    // A guessed cutoff presented as a fitted one is a number nobody can trust,
    // so a run that insists on fitted cutoffs loses those rules on purpose.
    const result = load(BUILTIN_RULES, { strictCalibration: true });
    expect(result.rules.map((r) => r.id)).toEqual([
      "test-name-describes-code",
      "test-name-verifies-claim",
      "test-mocks-subject",
      "snapshot-only-behaviour-claim",
    ]);
    expect(result.skipped.filter((s) => /uncalibrated/.test(s.reason))).toHaveLength(6);
  });

  test("the ten shipped rules all validate, and six of them are uncalibrated", () => {
    expect(BUILTIN_RULES).toHaveLength(10);
    for (const r of BUILTIN_RULES) expect(validateRule(r)).toEqual([]);
    expect(BUILTIN_RULES.filter((r) => !r.calibrated)).toHaveLength(6);
    // Distinct ids, and each with a docs page a reader can open.
    expect(new Set(BUILTIN_RULES.map((r) => r.id)).size).toBe(10);
    for (const r of BUILTIN_RULES) expect(r.docs).toMatch(/^docs\/rules\/.*\.md$/);
  });
}
