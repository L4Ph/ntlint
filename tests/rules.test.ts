import { expect, test } from "vite-plus/test";
import { loadRules, validateRule } from "../src/core/rules.ts";
import { BUILTIN_RULES } from "../src/rules/index.ts";
import { rule } from "./builders.ts";
import type { Capability } from "../src/core/types.ts";

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
    allowUncalibrated: true,
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

test("an uncalibrated rule is skipped unless the run asks for it", () => {
  // A guessed cutoff presented as a fitted one is a number nobody can trust.
  const result = load(BUILTIN_RULES, { allowUncalibrated: false });
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
