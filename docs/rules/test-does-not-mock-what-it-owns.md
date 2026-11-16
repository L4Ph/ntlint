# test-does-not-mock-what-it-owns

**warning** · placeholder · cutoff 0.5

## What it asks

This test replaces a collaborator the project owns with a double, so the test passes while the real collaboration is broken.

## How the answer is read

**true** — The double stands in for code in this repository -- another module, service or repository this project writes -- so the test never exercises the real contract between them.

**false** — The double stands in for a system outside this repository: a third-party API, a mailer, a message bus, the clock. A thin adapter around such a system is the right place to put it.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, doubles.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
