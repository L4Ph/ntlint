# noul-testlint

A linter for tests. One rule applies to every language, and the verdict comes
from a classifier that answers a natural-language question with a probability.
The command is `ntlint`.

```
$ npx noul-testlint check src --dry-run
85 test(s) in 40 file(s); 504 question(s)
about 495,775 input tokens, $0.0208 at $0.042/Mtok
no request was made (--dry-run)
```

## What it is for

A test's name is a claim about its behaviour. When the body stops establishing
that claim -- a name that says `rejects` over a body that checks an ordinary
value, a snapshot standing in for a property it cannot isolate, a mock that
supplies the very behaviour being asserted -- no compiler, type checker or
linter has anything to say. That gap is what this tool looks at.

What it is **not** for: anything a compiler, type checker or conventional linter
already decides. Those belong to the tools you already run.

## Install

```bash
npm install --save-dev noul-testlint
export TYPESAFE_API_KEY=...      # https://typesafe.ai; the key comes from the environment only
npx ntlint check src
```

`--dry-run` prices a run and makes no request, so it needs no key.

## Output

JSON Lines by default: one object per finding, then a summary.

```json
{"type":"finding","ruleId":"test-name-verifies-claim","docs":"docs/rules/test-name-verifies-claim.md","severity":"warning","messageId":"candidate","file":"src/cart.test.ts","line":12,"endLine":14,"subject":"applies the discount","subjectSource":"test","value":0.72,"at":0.66,"margin":1.09,"confidence":null}
{"type":"summary","verdicts":429,"reported":20,"candidates":20,"unsure":0,"missing":0,"requests":6,"inputTokens":180969,"usd":0.0076,"cached":102,"failures":0,"complete":true}
```

`--format json` is one document, `--pretty` is for a person, `--github` writes
annotations. `complete: false` means the run could not ask about everything, and
the exit code is non-zero: a run that failed is not a clean repository.

## Rules

Seventeen ship. **None of their cutoffs was fitted on your corpus**, and the
output says so:

| provenance    | count | what it means                                                                                         |
| ------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `fitted`      | 0     | measured against this repository's corpus                                                             |
| `borrowed`    | 5     | measured by [jev-lint](https://github.com/mizchi/jev-lint) on its fixtures, against the same question |
| `placeholder` | 12    | never measured; the number only decides whether a candidate is worth showing                          |

Only a `fitted` cutoff can report a violation. Everything else is reported as a
candidate: the signal is there, and nothing unfitted turns an exit code.
`--fitted-only` drops them all, which today means everything.

Read a finding as a candidate for a human to judge, not a verdict to act on.

## Languages

|                         | how a test is found    | assertion                          |
| ----------------------- | ---------------------- | ---------------------------------- |
| TypeScript / JavaScript | `it(...)`, `test(...)` | `expect(...).toBe(...)`            |
| Python                  | `def test_*`           | `assert` statement, `self.assert*` |
| Rust                    | `#[test]`              | `assert_eq!` and friends           |
| Go                      | `func TestX`           | `t.Fatalf(...)`                    |

Discovery is by construct, never by file path: vitest in-source tests
(`if (import.meta.vitest)`) and Rust `#[cfg(test)] mod tests` inside a
production file are found like any other test.

## Caching

Answers are cached under the question, the facts, the arm and the state, in
`.test-lint/cache.json`. A second run over the same tree makes no request. Editing
the implementation re-asks, because the state is part of the question.

## Design

[docs/design.md](docs/design.md) records what was measured and what was not, and
why a rule is code rather than a sentence in a data file.

MIT.
