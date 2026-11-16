# test-asserts-the-outcome

**warning** · placeholder · cutoff 0.5

## What it asks

The assertions check how a collaborator was called rather than what the code under test produced.

## How the answer is read

**true** — The only checks are that a collaborator was called, how many times, or with what arguments, while the value, state or output this code produced is never examined.

**false** — The assertion checks the result -- the returned value, the stored state, the emitted output -- or the call itself is the outcome, such as the single side effect the code exists to perform.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, assert.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
