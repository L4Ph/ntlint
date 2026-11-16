# test-name-verifies-claim

**warning** · borrowed (jev-lint@af58a3b rules/typescript/test-name-verifies-claim/rule.yml) · cutoff 0.66

## What it asks

This test would still pass if the behaviour its name claims were broken.

## What the answer must not read as

Two things to read for. A snapshot records whatever the output was: under a name that claims a specific property of the output (a row hidden, a footer omitted, a hint shown, a format) it establishes nothing about that property, while under a name that only says renders, or snapshot, or labels the variant rendered, it is the whole claim. And a body whose named operation is never called, or whose named case is never set up, establishes nothing however exact its assertion is. Three more, for assertions that are not a snapshot of text. A screenshot comparison (toHaveScreenshot) against a baseline image a person reviewed is the assertion under a name claiming what is visibly on screen in a state the body sets up; it shows nothing a picture cannot, such as a request or a stored value. A query by accessible name, getByRole(role, { name }), that has to succeed establishes that the element exposes that name. And when the name claims only that something does not fail -- it completes without throwing, it accepts an input -- an assertion that it does not throw establishes it.

## How the answer is read

**true** — The body does not establish what the name claims: it asserts nothing at all, it asserts something that would hold whether or not the named behaviour worked, it checks an incidental property such as a length or a type instead of the named behaviour itself, or it never sets up the case the name is about so the assertion never exercises it.

**false** — The body contains at least one assertion that would fail if the named behaviour were broken. Read the name for what it actually claims: a name that claims only that something renders, or that the output matches a snapshot, or that only labels the input the snapshot was taken of, is established by the snapshot; a name that claims an interaction with a collaborator -- that something was called, once, with these arguments -- is established by an assertion on that call.

## When it is asked

every subject it is asked about. Judged subject: test. Needs: model, test.

A cutoff is a claim about one corpus. `borrowed` means it was measured elsewhere, against the same question.
