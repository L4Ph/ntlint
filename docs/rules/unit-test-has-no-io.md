# unit-test-has-no-io

**warning** · placeholder · cutoff 0.5

## What it asks

This test reaches the network, the filesystem or a subprocess, so it cannot be the small test its position in the suite claims.

## How the answer is read

**true** — The test's own behaviour depends on a system outside this process -- a request, a file it reads or writes, a command it runs -- and nothing in the test replaces that system.

**false** — The call is to a fake, a fixture server the test starts itself, or the test is an integration test whose boundary is the point. Reading a fixture the test owns is not the defect.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, io.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
