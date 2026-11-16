# test-is-not-abandoned

**warning** · placeholder · cutoff 0.5

## What it asks

This test was left abandoned: skipped, focused, or a placeholder with no check, rather than a case the suite runs.

## How the answer is read

**true** — The skip marker has outlived its reason: a placeholder body with no assertion, a case skipped with no reason recorded, or a focused test that silently stops the rest of the suite from running.

**false** — The skip is a current, stated decision -- a dependency that has not shipped, a platform that cannot run it -- and the reason is visible in the test or its marker.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, skip.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
