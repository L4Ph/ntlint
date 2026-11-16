# test-cleans-up-its-doubles

**warning** · placeholder · cutoff 0.5

## What it asks

This test installs a double and leaves it installed, so a later test in the same file can see it.

## How the answer is read

**true** — The double replaces something shared -- a module, a global, a clock -- and nothing in this test or its suite's teardown restores it, so the next test runs against the double.

**false** — The double is restored in the test, in an after-each hook, or by the framework's own automatic restore that this file enables.

## When it is asked

subjects its gate accepts. Judged subject: test. Needs: model, doubles, hooks.

A cutoff is a claim about one corpus. `placeholder` means it was never measured, so this rule can only report a candidate.
