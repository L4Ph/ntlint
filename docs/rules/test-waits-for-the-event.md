# test-waits-for-the-event

**warning** · placeholder · cutoff 0.5

## What it asks

This test waits a fixed delay where waiting for the event would do.

## How the answer is read

**true** — The delay stands in for an event the test could wait on -- a request, a render, a callback -- so the test is slower than it needs to be and fails on a loaded machine.

**false** — Elapsed time is what the test establishes: a timeout, a debounce, a rate limit, a retry backoff. There the delay is the subject, not a shortcut.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, sleep.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
