import { defineRule } from "@test-lint/core";

/**
 * New in this tool, uncalibrated. Criteria S2 and N6: a small test makes no
 * network call and touches no files.
 *
 * Reading the environment is legitimate in an integration test, which is why
 * the rule asks rather than declares the defect.
 */
export default defineRule({
  id: "unit-test-has-no-io",
  docs: "docs/rules/unit-test-has-no-io.md",
  severity: "warning",
  requires: ["model", "io"],
  kind: "noul",
  calibration: "placeholder",
  calibrationSource: null,
  threshold: 0.5,
  ask: "This test reaches the network, the filesystem or a subprocess, so it cannot be the small test its position in the suite claims.",
  note: null,
  criteria: {
    true: "The test's own behaviour depends on a system outside this process -- a request, a file it reads or writes, a command it runs -- and nothing in the test replaces that system.",
    false:
      "The call is to a fake, a fixture server the test starts itself, or the test is an integration test whose boundary is the point. Reading a fixture the test owns is not the defect.",
  },
  levels: null,
  gate: (test) => test.facts.io > 0,
  require: null,
  candidate: null,
});
