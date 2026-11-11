import { defineRule } from "@test-lint/core";

/**
 * Ported from jev-lint `rules/typescript/snapshot-only-behaviour-claim` (MIT).
 *
 * `requires: snapshot`, so a language with no snapshot concept does not run it.
 * That is not a loss: the rule asks about a construct the language does not
 * have, and running it there would produce a finding about nothing.
 */
export default defineRule({
  id: "snapshot-only-behaviour-claim",
  docs: "docs/rules/snapshot-only-behaviour-claim.md",
  severity: "warning",
  requires: ["model", "snapshot"],
  kind: "noul",
  calibrated: true,
  threshold: 0.67,
  ask: "This test's name claims a specific behaviour, but the body only compares a snapshot.",
  criteria: {
    true: "The name claims a property of the output -- a row hidden, a footer omitted, a format, a hint shown -- and the body's only check is a snapshot, which records whatever the output was without establishing that property.",
    false:
      "Either the body checks the claimed property directly, or the name claims only that the output renders, in which case the snapshot is the whole claim.",
  },
  levels: null,
  gate: null,
  require: null,
  candidate: null,
});
