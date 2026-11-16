# test-is-deterministic

**warning** · placeholder · cutoff 0.5

## What it asks

This test reads the wall clock, randomness or a generated id directly, so the same code can produce a different result on another run.

## How the answer is read

**true** — The value that decides the assertion comes from the real clock, real randomness or a real generated id, and nothing in the test pins it, so a run at another moment can disagree.

**false** — Time or randomness is what the test establishes, and the test controls it: a fake clock advanced deliberately, a seeded generator, an id passed in as an argument.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, nondeterminism.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
