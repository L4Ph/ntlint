# test-lint design

A linter that judges whether a test is in a shape generally agreed to be good,
in any language, and reports a verdict an agent can act on.

Two things separate it from the per-language linters that already exist
(`eslint-plugin-jest`, `flake8-pytest-style`, `testifylint`, `rubocop-rspec`,
`xunit.analyzers`): **one rule applies to every language**, and **every verdict
comes from Jev** -- a classifier that answers a natural-language question with a
probability -- with the rule's own cutoff.

Depth is not the goal. Those tools are deeper per language and will stay that
way. The product is the same norm, spelled once, judged the same way, reported
in one schema, across languages and across repositories.

## Non-goals

- **Suite-level policy.** Coverage targets, mutation scores, CI stage routing,
  per-size time budgets, and test owners are about a suite, not a test. Roughly
  half of r5's 110 criteria are this, and they are out of scope by construction.
- **Anything a compiler, type checker or linter already decides.** Same scoping
  rule jev-lint states, for the same reason.
- **Deletion.** The tool never suggests removing a test. A finding is a
  candidate for a human or an agent to judge.
- **A sandbox.** Plugins are dependencies, the way ESLint and oxlint plugins
  are. Constraints are enforced structurally (see below), not by isolation.

## What has to be deterministic

Not the detection, and not the model's answer -- both are approximate, and
jev-lint's own measurement puts pass-to-pass spread at a median of 0.010 and a
p90 of 0.050. What is deterministic is the **contract an agent sees**:

| Guarantee                      | Mechanism                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Same input, same output        | verdict cache keyed on the question and the state                                               |
| A fixed output schema          | `{ruleId, file, line, severity, value, at, confidence, messageId, subjectSource}`; no free text |
| Falsifiability                 | `--replay` re-scores a recorded run; changing a cutoff invalidates nothing                      |
| Instability is visible         | `--retry n` reports the mean with `over/of`; `--loose` lists the band under the cutoff          |
| A failed request is not a pass | `messageId: "missing"`, never silence                                                           |
| No ambient inputs              | clock, randomness, locale and terminal colour never reach a verdict                             |

That is the whole claim. "Deterministic" here never means "the matcher is
exact".

## Pipeline

```
vocab/<language>          data
      |
      v
extract (ast-grep)   test containers + structural facts
      |
      v
TestSubject          { source, name, facts, subjectSource }
      |
      v
buildState / buildQuestion      one state per batch, one question per rule
      |
      v
ctx.judge(ask, threshold)       Jev -- always
      |
      v
gate                   value >= cutoff -> flag | candidate | missing
      |
      v
cache + report         json | github | sarif | pretty
```

Three properties of this shape are load-bearing:

- **The subject is the test, not the file.** The default state arm is `bare`:
  title and body are the question's own evidence, so an unrelated edit in the
  same file cannot move the verdict, and the cache stays stable.
- **Facts are evidence, not verdicts.** A language whose vocabulary is
  incomplete yields `facts: {}` and the model still reads the source. The
  verdict degrades; it does not disappear. This is what makes "any language"
  survivable.
- **Every rule goes through Jev.** There is no deterministic verdict path, so
  there is no second engine and no second output shape.

## Rule plugin API

A rule is code. There is no YAML rule format: YAML could carry a sentence and a
cutoff, and nothing else -- no question gating, no postcondition, no second
opinion, no subject assembly.

```ts
export default jevRule({
  id: "test-name-verifies-claim",
  docs: "https://…/rules/test-name-verifies-claim",
  severity: "warning",
  capabilities: ["model"],
  ask: "The assertions in this test verify the behaviour its name claims.",
  criteria: {
    true: "…",
    false: "…",
  },
  threshold: 0.62,
  // Optional: narrow the question before spending a request.
  gate: (test) => test.facts.assertions > 0, // a test with none is asked elsewhere
  // Optional: refuse an answer that is not usable for this rule.
  require: (answer) => answer.confidence >= 0.4,
  // Optional: the answer is fine but the claim is weak.
  candidate: (answer) => answer.value < 0.75,
});
```

`gate`, `require` and `candidate` are the constraints YAML cannot express. They
are why the plugin is code rather than data.

A rule that needs no model is expressed as facts plus a Jev question about
those facts, not as a model-free verdict. `facts.assertions === 0` is not a
finding; "this test asserts nothing, unless the assertion is one call below"
is a question only the model can answer.

## Execution model

- **In-process**, like ESLint and oxlint plugins.
- **The key never reaches plugin code.** The host reads `TYPESAFE_API_KEY` /
  `TYPESAFEAI_API_KEY`, then deletes it from `process.env` before loading
  plugins. A plugin cannot find it, and there is no HTTP client to hand it.
- **One way to the model:** `ctx.judge`. Pacing, retry, splitting on
  `max_tokens_exceeded`, spend accounting and the cache all live behind it.
- **`--deterministic` refuses at load.** A plugin declaring `model`, `clock` or
  `random` is not executed in that mode; `rules` prints why it was skipped.
- **Per-rule budget.** Exceeding it is a rule error, reported as such, not a
  finding about the code.
- **Required metadata.** `id`, `docs`, `severity` and a canary fixture. A rule
  without them fails to load.

## Vocabulary data

The only language-dependent artifact. Two sections: symbols and structure.

```yaml
# vocab/rust.yml
grammars: [Rust]
test:
  # Rust has no test construct in its grammar: the attribute is a sibling of
  # the function, and jev-lint measures it with a text marker. Marked as an
  # approximation until a `follows` relation is shown to be reliable.
  marker: '#\[\s*(tokio::)?test\s*\]'
  container: function_item
structure:
  loop: [loop_expression, while_expression, for_expression]
  conditional: [if_expression, match_expression]
  try: [try_expression]
  call: [call_expression, macro_invocation]
assert:
  - { shape: macro, callee: "^assert(_eq|_ne)?!$" }
skip:
  marker: '#\[\s*ignore\s*\]'
sleep:
  - { callee: "^thread::sleep$" }
```

`assert`, `double`, `sleep` and `skip` are **predicates over a node**, not
names: a callee pattern, optionally an import source or an argument shape. A
bare name is not enough -- `assert` is also a variable name. Python's assertion
is a statement, Rust's is a macro, Go's is a method call, so each entry carries
a `shape`.

A rule never names a language. It reads `test.facts.*` and `test.body`, and
`requires:` names the capabilities it needs (`snapshot`, `async`, `doubles`,
`hooks`). A language whose vocabulary does not declare one simply does not run
that rule, and `rules` says so.

## Subject fallback ladder

There is no `test` node kind in most grammars; a test is a convention. So
extraction degrades instead of failing silently:

| Step | What is judged                                | `subjectSource` |
| ---- | --------------------------------------------- | --------------- |
| 1    | The test container: title and body            | `test`          |
| 2    | The function a marker identifies as a test    | `function`      |
| 3    | The file, when the language has no vocabulary | `file`          |

Every finding carries `subjectSource`, so an agent can tell a whole-file verdict
from a test verdict.

## Cache

```
verdictKey = sha256(SCHEMA, rule.id, ruleTextHash(rule), factsHash, arm, subjectText)
```

`factsHash` is not in jev-lint's key because it has no facts. Without it, fixing
a vocabulary would keep serving verdicts formed from the old facts -- the same
class of bug jev-lint records under "Known imprecisions". `threshold` stays out:
recalibration must be free.

## Verification

A vocabulary is correct when its extraction agrees with the runner's own
discovery. This is deterministic, needs no API key, and runs in CI:

| Language   | Oracle                                                       |
| ---------- | ------------------------------------------------------------ |
| TypeScript | `vp test list`                                               |
| Python     | `pytest --collect-only -q`                                   |
| Go         | `go test -list '.*' ./...`                                   |
| Rust       | `cargo test -- --list` (doc tests excluded before comparing) |

A mismatch is a vocabulary bug, not a tolerance to widen.

Rule quality is measured on a canary set: known-bad and known-good tests per
rule, re-scored on every release, with precision and recall written into the
README. A rule that cannot separate them does not ship, the same standard
jev-lint holds itself to.

## Decisions

- **Decided: rules are code, not YAML, because** the constraints worth having
  (question gating, postconditions, candidate downgrade) are control flow.
  `Reason` per rule is recorded here rather than invented later.
- **Decided: every rule goes through Jev, because** a deterministic verdict
  path would need a per-language matcher for every norm, which is exactly the
  framework-shaped rule set this tool exists to avoid.
- **Decided: facts are evidence, not verdicts, because** an incomplete
  vocabulary must weaken a question rather than suppress a verdict.
- **Decided: vocabulary is data, because** adding a language should be a
  thirty-line diff, and a reviewer must be able to check the norm by reading it.
- **Decided: in-process, with the key removed from the environment, because**
  Node's permission model only applies at process start, and per-plugin
  processes would dominate the runtime of a twenty-rule run.
- **Decided: `bare` by default, because** jev-lint measures its test rules at
  1.00/1.00 on `bare`, and `bare` keeps the cache stable. `test-mocks-subject`
  is `located`, because whether a double supplies the asserted behaviour is not
  visible in the test alone.
- **Decided: vendor jev-lint's ECMAScript test matcher, because** it already
  covers jest, vitest, node:test, Playwright, Deno and bun, including
  `test.each`, `{ name }` forms, subtests and the `it.todo` exclusion. MIT, with
  attribution and the source commit recorded in `THIRD_PARTY.md`.
- **Decided: v0.1 ships four vocabularies (TypeScript, Python, Rust, Go),
  because** those are the languages the reference implementation already
  measures, and each exercises a different extraction shape: call, name
  convention, attribute, and method. Adding a fifth before these four agree
  with their runners would test nothing new.

## v0.1 rules

Six ported from jev-lint, whose cutoffs were fitted on their fixtures:
`test-name-describes-code`, `test-name-verifies-claim`,
`tests-cover-failure-paths`, `test-mocks-subject`,
`snapshot-only-behaviour-claim`, `describe-names-subject`.

Four new, each needing its own canary before its cutoff is claimed:
`test-asserts-something`, `no-abandoned-test` (skip/only/focus),
`no-fixed-delay` (fixed sleep where a synchronization point exists),
`test-structure-is-flat` (assertions not buried in loops or conditionals).

**Decided: ten rules in v0.1 rather than seventeen, because** under an
always-Jev design every rule needs fixtures and a fitted cutoff -- a
deterministic rule would have needed neither. Seventeen is roughly twice the
calibration cost and buys no new mechanism. The remaining seven land in v0.1.1,
each with its precision published.

## Open questions

- Does Jev answer meaningfully on Ruby and Elixir, where no fixture exists yet?
  Unmeasured. Not in v0.1.
- Should `explain` labels be standardised across rules so findings can be
  aggregated by reason? Deferred until there are enough findings to aggregate.
- Is a file-level fallback (`subjectSource: "file"`) ever useful, or always
  noise? Measure on a language without a vocabulary before shipping it.

## Units

Each unit's `verify` is the narrowest command that fails when the unit
regresses.

| Unit              | Acceptance                                                                                                                | Verify                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `plugin-loader`   | A plugin declaring `model` is refused under `--deterministic`; the key is absent from `process.env` when plugin code runs | `vp test tests/plugin.test.ts`         |
| `vocab-loader`    | A user vocabulary overrides a shipped one; a duplicate id is a load error, not a silent shadow                            | `vp test tests/vocab.test.ts`          |
| `extract-ts`      | Test count and name/body agree with `vp test list` on the fixture suite                                                   | `vp test tests/extract-ts.test.ts`     |
| `extract-python`  | Agrees with `pytest --collect-only -q`                                                                                    | `vp test tests/extract-python.test.ts` |
| `extract-go`      | Agrees with `go test -list '.*'`                                                                                          | `vp test tests/extract-go.test.ts`     |
| `extract-rust`    | Agrees with `cargo test -- --list`, doc tests excluded; approximate cases assert `subjectSource: "function"`              | `vp test tests/extract-rust.test.ts`   |
| `judge-and-cache` | Two runs with the same input hit the cache and print identical findings; changing a fact invalidates the entry            | `vp test tests/judge.test.ts`          |
| `gate-and-report` | `missing` never reads as clean; `--fail-on error` does not fail on a warning                                              | `vp test tests/gate.test.ts`           |
| `rules-ported`    | Each ported rule reproduces its jev-lint fixture decisions at the ported cutoff                                           | `test-lint eval --replay`              |
| `rules-new`       | Each new rule separates its canary set; precision and recall in the README                                                | `test-lint eval --replay`              |
| `canary`          | A rule that detects nothing fails the canary rather than passing quietly                                                  | `vp test tests/canary.test.ts`         |
