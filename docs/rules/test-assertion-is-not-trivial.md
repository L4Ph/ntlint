# test-assertion-is-not-trivial

**warning** · placeholder · cutoff 0.5

## What it asks

An assertion in this test compares a value with itself, so it cannot fail.

## How the answer is read

**true** — The assertion is a placeholder: the expected value is the actual expression, the same literal on both sides, or a tautology such as asserting that a value equals itself.

**false** — The two sides come from different places -- a value the code produced against one written out, or two independent results -- so the assertion can disagree with the code.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, assert.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
