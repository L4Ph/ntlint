# test-name-is-unique

**warning** · placeholder · cutoff 0.5

## What it asks

Another test in this file has the same name and checks the same thing, so one of them adds no coverage.

## How the answer is read

**true** — The two bodies assert the same outcome from the same setup, so one of them can fail only when the other does.

**false** — The names collide but the cases differ -- different input, different branch, different expected outcome -- so both carry their own evidence and only the naming is wrong.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, test.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
