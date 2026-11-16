# test-structure-is-flat

**warning** · placeholder · cutoff 0.5

## What it asks

The assertions in this test sit inside a loop or a conditional, so a changed branch could leave them never running.

## How the answer is read

**true** — An assertion's pass or fail depends on a branch taken in the same body, so a test that reports success may have checked nothing on the path that ran.

**false** — The loop is a table of cases that are each meant to be checked, or the conditional guards an environment the assertion is not about.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, assert.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
