import { defineRule } from "@test-lint/core";

/**
 * Ported from jev-lint `rules/typescript/test-name-verifies-claim` (MIT).
 *
 * The note is the measured part: it moved label-only snapshot cleans from
 * 0.50-0.55 to 0.32-0.41 while keeping the snapshot-under-a-claim defects at
 * 0.55-0.76. Spelling the same reasoning into `criteria.true` was measured
 * worse -- it lifted every snapshot test, including the clean ones.
 */
export default defineRule({
  id: "test-name-verifies-claim",
  docs: "docs/rules/test-name-verifies-claim.md",
  severity: "warning",
  requires: ["model", "test"],
  kind: "noul",
  calibrated: true,
  threshold: 0.66,
  ask: "This test would still pass if the behaviour its name claims were broken.",
  criteria: {
    true: "Breaking the behaviour the name claims -- removing it, inverting it, returning the early value -- would leave every assertion in this body passing.",
    false:
      "At least one assertion in this body fails when the behaviour the name claims is broken.",
  },
  levels: null,
  gate: null,
  require: null,
  candidate: (answer) => answer.value >= 0.66 && answer.value < 0.75,
});
