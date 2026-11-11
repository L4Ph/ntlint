import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated. The r5-test-audit criterion D7: a double
 * replaces a system the project does not control.
 *
 * The fact is that a double exists; whether it stands in for something the
 * project owns is the question, and no matcher can answer it.
 */
export default defineRule({
  id: "test-does-not-mock-what-it-owns",
  docs: "docs/rules/test-does-not-mock-what-it-owns.md",
  severity: "warning",
  requires: ["model", "doubles"],
  kind: "noul",
  calibration: "placeholder",
  calibrationSource: null,
  threshold: 0.5,
  ask: "This test replaces a collaborator the project owns with a double, so the test passes while the real collaboration is broken.",
  note: null,
  criteria: {
    true: "The double stands in for code in this repository -- another module, service or repository this project writes -- so the test never exercises the real contract between them.",
    false:
      "The double stands in for a system outside this repository: a third-party API, a mailer, a message bus, the clock. A thin adapter around such a system is the right place to put it.",
  },
  levels: null,
  gate: (test) => test.facts.doubles > 0,
  require: null,
  candidate: null,
});
