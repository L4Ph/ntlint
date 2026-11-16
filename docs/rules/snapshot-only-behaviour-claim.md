# snapshot-only-behaviour-claim

**warning** · borrowed (jev-lint@af58a3b rules/typescript/snapshot-only-behaviour-claim/rule.yml) · cutoff 0.67

## What it asks

This test's name claims a specific behaviour, but the body only compares a snapshot.

## What the answer must not read as

A snapshot beside a targeted assertion is fine. "Renders X for input Y" is a label for the snapshot; "renders X when Y" or "hides/sorts/formats X" is a claim the snapshot does not isolate.

## How the answer is read

**true** — The title asserts a property of the output -- an ordering, an element hidden or shown, a particular state or branch rendered under a condition ("renders the empty state when the list is empty"), a format or conversion applied -- and the only assertions are toMatchSnapshot, toMatchInlineSnapshot or toMatchFileSnapshot over a whole rendering, so nothing in the test isolates the named property from everything else in the output.

**false** — The title claims only that the output matches a snapshot, or that something renders, or it only names the input the snapshot was taken of ("renders the list for three users") without asserting a property of the output; or at least one assertion targets the named behaviour directly; or the inline snapshot is a short literal that is itself the named outcome.

## When it is asked

every subject it is asked about. Judged subject: test. Needs: model, snapshot.

A cutoff is a claim about one corpus. `borrowed` means it was measured elsewhere, against the same question.
