import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated. Criterion W2: no copy-pasted cases.
 *
 * The fact is that two tests in one file share a name; whether they are the
 * same case is what the body answers. A duplicate name with a different body is
 * a naming defect, which is why the question is not "delete one".
 */
export default defineRule({
  id: "test-name-is-unique",
  docs: "docs/rules/test-name-is-unique.md",
  severity: "warning",
  requires: ["model", "test"],
  kind: "noul",
  calibrated: false,
  threshold: 0.5,
  ask: "Another test in this file has the same name and checks the same thing, so one of them adds no coverage.",
  criteria: {
    true: "The two bodies assert the same outcome from the same setup, so one of them can fail only when the other does.",
    false:
      "The names collide but the cases differ -- different input, different branch, different expected outcome -- so both carry their own evidence and only the naming is wrong.",
  },
  levels: null,
  gate: (test) => test.facts.duplicateName,
  require: null,
  candidate: null,
});
