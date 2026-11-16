import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated.
 *
 * A fixed sleep is a deterministic fact, and that is exactly why the verdict is
 * still a question: some tests are about time, and a sleep is the subject
 * rather than a shortcut. The fact narrows the question to tests that sleep;
 * the model decides whether waiting for the event would do.
 */
export default defineRule({
  id: "test-waits-for-the-event",
  docs: "docs/rules/test-waits-for-the-event.md",
  severity: "warning",
  requires: ["model", "sleep"],
  subject: "test",
  kind: "noul",
  calibration: "placeholder",
  calibrationSource: null,
  threshold: 0.5,
  ask: "This test waits a fixed delay where waiting for the event would do.",
  note: null,
  criteria: {
    true: "The delay stands in for an event the test could wait on -- a request, a render, a callback -- so the test is slower than it needs to be and fails on a loaded machine.",
    false:
      "Elapsed time is what the test establishes: a timeout, a debounce, a rate limit, a retry backoff. There the delay is the subject, not a shortcut.",
  },
  levels: null,
  gate: (test) => test.facts.sleeps > 0,
  require: null,
  candidate: null,
});
