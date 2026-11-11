import { defineRule } from "@test-lint/core";

/**
 * Ported from jev-lint `rules/typescript/test-name-describes-code` (MIT), with
 * its sentence and its fitted cutoff. The cutoff was fitted on jev-lint's own
 * fixtures at `tests/` in that repository; it is a starting point here, not a
 * calibration for this corpus, and `docs/design.md` says so.
 */
export default defineRule({
  id: "test-name-describes-code",
  docs: "docs/rules/test-name-describes-code.md",
  severity: "warning",
  requires: ["model", "test"],
  kind: "noul",
  calibrated: true,
  threshold: 0.72,
  ask: "The operation, input or outcome this test's code exercises is not the one its name names.",
  criteria: {
    true: "The body runs something other than what the name says: it calls a different operation, sets up a different input, or expects a different outcome. A name that says `rejects` over a body that asserts an ordinary value is true; a name that says `above` over a body that sets the below case is true.",
    false:
      "The body calls the operation the name names, on the input the name names, and expects the outcome the name names. A weak or missing assertion is not a different outcome -- only a claim the code contradicts is.",
  },
  levels: null,
  gate: null,
  require: null,
  candidate: null,
});
