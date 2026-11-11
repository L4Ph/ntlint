/**
 * The rules that ship.
 *
 * A built-in rule is a plugin that ships with the tool, not part of its engine,
 * so this package depends on the core and the core does not know it exists.
 *
 * Two of jev-lint's test rules are deliberately not here: `tests-cover-failure-paths`
 * pairs a function with the tests that reach it, which needs a subject shape v0.1
 * does not have. `describe-names-subject` is here, on a suite subject.
 */
import { loadRules, validateRule } from "@test-lint/core";
import { rule } from "@test-lint/core/testing";
import type { Capability, Rule } from "@test-lint/core";

import describeNamesSubject from "./describe-names-subject.ts";
import snapshotOnlyBehaviourClaim from "./snapshot-only-behaviour-claim.ts";
import testAssertionIsNotTrivial from "./test-assertion-is-not-trivial.ts";
import testAssertsSomething from "./test-asserts-something.ts";
import testAssertsTheOutcome from "./test-asserts-the-outcome.ts";
import testCleansUpItsDoubles from "./test-cleans-up-its-doubles.ts";
import testDoesNotMockWhatItOwns from "./test-does-not-mock-what-it-owns.ts";
import testIsDeterministic from "./test-is-deterministic.ts";
import testIsNotAbandoned from "./test-is-not-abandoned.ts";
import testMocksSubject from "./test-mocks-subject.ts";
import testNameDescribesCode from "./test-name-describes-code.ts";
import testNameIsASpecification from "./test-name-is-a-specification.ts";
import testNameIsUnique from "./test-name-is-unique.ts";
import testNameVerifiesClaim from "./test-name-verifies-claim.ts";
import testStructureIsFlat from "./test-structure-is-flat.ts";
import testWaitsForTheEvent from "./test-waits-for-the-event.ts";
import unitTestHasNoIo from "./unit-test-has-no-io.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  // Ported from jev-lint, with the fitted cutoffs their own fixtures produced.
  testNameDescribesCode,
  testNameVerifiesClaim,
  testMocksSubject,
  snapshotOnlyBehaviourClaim,
  describeNamesSubject,
  // New here. Uncalibrated: they run as candidates and never turn an exit code.
  testAssertsSomething,
  testAssertsTheOutcome,
  testAssertionIsNotTrivial,
  testIsNotAbandoned,
  testWaitsForTheEvent,
  testStructureIsFlat,
  testNameIsASpecification,
  testNameIsUnique,
  testDoesNotMockWhatItOwns,
  testCleansUpItsDoubles,
  testIsDeterministic,
  unitTestHasNoIo,
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
    "io",
    "nondeterminism",
  ]);

  const load = (defs = BUILTIN_RULES, overrides: Partial<Parameters<typeof loadRules>[1]> = {}) =>
    loadRules(defs, {
      capabilities: ALL,
      deterministic: false,
      fittedOnly: false,
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

  test("a fitted-only run drops every rule whose cutoff was measured elsewhere", () => {
    // Nothing here has been measured against this repository's corpus, so a run
    // that insists on fitted cutoffs has nothing to run. That is the truth, and
    // printing it beats running seventeen borrowed thresholds as if they were ours.
    const result = load(BUILTIN_RULES, { fittedOnly: true });
    expect(result.rules).toHaveLength(0);
    expect(result.skipped).toHaveLength(17);
  });

  test("seventeen rules ship: five borrowed, twelve placeholders, none fitted here", () => {
    expect(BUILTIN_RULES).toHaveLength(17);
    for (const r of BUILTIN_RULES) expect(validateRule(r)).toEqual([]);
    expect(BUILTIN_RULES.filter((r) => r.calibration === "fitted")).toHaveLength(0);
    expect(BUILTIN_RULES.filter((r) => r.calibration === "borrowed")).toHaveLength(5);
    expect(BUILTIN_RULES.filter((r) => r.calibration === "placeholder")).toHaveLength(12);
    // A borrowed cutoff names where it came from, or a reader cannot check it.
    for (const r of BUILTIN_RULES.filter((r) => r.calibration === "borrowed")) {
      expect(r.calibrationSource).toMatch(/^jev-lint@[0-9a-f]+ /);
    }
    expect(new Set(BUILTIN_RULES.map((r) => r.id)).size).toBe(17);
    for (const r of BUILTIN_RULES) expect(r.docs).toMatch(/^docs\/rules\/.*\.md$/);
  });

  test("every rule asks something, and none of them asks with a cutoff in it", () => {
    // The cutoff is the runner's decision; a rule that wrote it into the
    // sentence would need rewriting on every recalibration.
    for (const r of BUILTIN_RULES) {
      expect(r.ask.trim().length).toBeGreaterThan(20);
      expect(r.ask).not.toMatch(/0\.\d+/);
    }
  });
}
