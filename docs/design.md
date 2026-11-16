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

## Where a test lives

A test is not always in a test file. Both languages with in-source testing are
in the v0.1 set:

```ts
// src/discount.ts -- vitest in-source testing
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it("applies the discount", () => {
    expect(applyDiscount(cart)).toBe(90);
  });
}
```

```rust
// src/discount.rs
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn applies_the_discount() { assert_eq!(apply_discount(cart), 90); }
}
```

Three consequences, each of which is a bug if missed:

1. **Discovery is by construct, never by path.** The tool does not glob
   `*.test.ts`; it walks the extensions its vocabularies claim and looks for
   tests anywhere in them, production sources included. A path filter would
   miss every in-source test silently, which is the failure mode this design
   treats as the most expensive one.
2. **Containers nest.** A Rust test sits inside `mod tests`, which may sit
   inside an `impl`. The container search must not assume a top-level node.
3. **The guard is not test logic.** `if (import.meta.vitest)` is a conditional
   wrapping every in-source test, and `#[cfg(test)]` is an attribute on the
   module. A rule that reads "an assertion inside a conditional or a loop" must
   treat both as transparent, or every in-source test becomes a false positive.

A vocabulary therefore declares its guards:

```yaml
test:
  guard:
    - { kind: if_statement, condition: '^import\.meta\.vitest$' }
    - { kind: mod_item, attribute: '^#\[cfg\(test\)\]$' }
```

And assertion resolution must accept the in-source import source: vitest's
in-source `expect` comes from `import.meta.vitest`, not from `"vitest"`. A
vocabulary that names only the package leaves `facts.assertions` empty and
turns "this test asserts nothing" into a false positive on every in-source
test.

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
- **No file is read for the key.** Not the config, not `.env`. The process reads
  its environment and nothing else; how a variable got into that environment is
  the person's decision (`export`, `source .env`, direnv), not the tool's.
- **One way to the model:** `ctx.judge`. Pacing, retry, splitting on
  `max_tokens_exceeded`, spend accounting and the cache all live behind it.
- **`--deterministic` refuses at load.** A plugin declaring `model`, `clock` or
  `random` is not executed in that mode; `rules` prints why it was skipped.
- **Per-rule budget.** Exceeding it is a rule error, reported as such, not a
  finding about the code.
- **Required metadata.** `id`, `docs`, `severity` and a valid question. A rule
  without them fails to load. A canary entry is required by the canary test
  rather than the loader, so the rule and its cases are added together.

## Languages

A language is a module, not a data file:

```ts
// packages/languages/src/typescript.ts
export default defineLanguage({
  name: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  parse: (source) => parse(Lang.TypeScript, source),
  tests: (root) => root.root().findAll(TEST).filter(titled),
  suites: (root) => root.root().findAll(SUITE).filter(titled),
  nameOf,
  facts(node, context) {
    /* ast-grep rules: assert, double, sleep, io, ... */
  },
});
```

Finding a test and counting what a rule reads **is parsing** -- it is ast-grep
work, against ast-grep's own rule vocabulary. A YAML file with a private dialect
for the same thing was a second copy of ast-grep's config, a validator for that
copy, and a translation layer between them: three things to keep in step for no
capability the code did not already have. The module is type-checked, its tests
sit beside it, and the rules it uses are the ones ast-grep documents.

What a language must answer: which nodes are tests and which are suites (a rule,
because selection fails silently), what a test's own name is, and what a rule can
read inside it (facts, since only the language knows that `vi.fn()` is a double
and `thread::sleep` is a wait).

A rule never names a language. Adding one is a module and a line in `LANGUAGES`.

`@ast-grep/napi` ships five grammars (Html, JavaScript, Tsx, Css, TypeScript).
Python, Rust and Go come from `@ast-grep/lang-*` packages -- compiled tree-sitter
parsers registered once per process -- and each has a module here:

| language   | how a test is found                           | assertion shape                                  |
| ---------- | --------------------------------------------- | ------------------------------------------------ |
| TypeScript | `it(...)` / `test(...)` call, by callee field | `expect(...).toBe(...)`, chained call            |
| Python     | `def test_*`                                  | `assert` **statement**, and `self.assert*` calls |
| Rust       | `#[test]` attribute **above** the function    | `assert_eq!` **macro**                           |
| Go         | `func TestX`                                  | `t.Fatalf(...)`, a method on the testing handle  |

Three grammars, three different shapes for the same fact, which is why the
language is a module and not a table row.

**Verification.** Rust was checked against `cargo test -- --list` on a fixture
crate with a unit test, an ignored test and an integration test: three tests, and
extraction found the same three. Python and Go are not verified yet -- pytest and
the go toolchain are not installed on this machine, so the oracle cannot run.

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

## Layout and tests

```
packages/core     @test-lint/core    vocabularies, extraction, client, run, gate, cache, report
packages/rules    @test-lint/rules   the built-in rules; depends on core, never the reverse
packages/cli      @test-lint/cli     check / --dry-run / --json, and the exit code; depends on both
```

A built-in rule is a plugin that ships with the tool, not part of its engine, so
the dependency runs one way.

**Grammars.** `@ast-grep/napi` ships five (Html, JavaScript, Tsx, Css,
TypeScript). Python, Go and Rust are separate `@ast-grep/lang-*` packages or a
compiled parser, so the four-language design needs a dependency decision before
it is true. Extraction says so rather than returning an empty answer: a
vocabulary naming a grammar this build cannot parse yields no subjects, and the
run prints what it could not read.

The tests live in the modules they cover, inside `if (import.meta.vitest)`
blocks, run through `test.includeSource`. A tool that judges in-source tests
should run its own. One trap: Vitest treats any file containing the guard as a
test file, so a doc comment that quotes the guard is a failing test file -- the
guard is described in prose where it is explained, and `.d.ts` files are
excluded from the source glob.

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

Two of the four have a second place a test can live, and both are verified on
their own fixtures rather than assumed:

- **TypeScript in-source** (`if (import.meta.vitest)`): `vp test list` must be
  shown to list these before it is trusted as the oracle. If it does not, the
  count comes from the fixture itself.
- **Rust in-source** (`#[cfg(test)] mod tests` in `src/`): `cargo test -- --list`
  lists them; doc tests are excluded before comparing.
- Python doctests are a different subject shape (a docstring, not a body) and
  are out of v0.1. Go has no in-source convention.

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
- **Decided: vocabulary is data, and YAML is the third runtime dependency,
  because** a vocabulary a reviewer cannot read is a vocabulary nobody checks,
  and the alternative -- a language table in code -- breaks "adding a language
  is a data change". `yaml` is the same dependency jev-lint carries for the
  same reason.
- **Decided: the tool reads no dotenv file, because** a checkout is
  attacker-controlled the moment somebody clones it, and a loader has to be
  narrow (only the key, never the endpoint) to be safe at all. That is a
  special case to remember, to test and to explain; reading `process.env` alone
  has none of those costs, and whoever typed the export meant it.
- **Decided: `docs` is a repository path today, not a URL, because** a URL would
  name a host this project has not chosen yet, and a path is checkable by the
  agent reading the same checkout. The validator accepts either.
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

Seventeen rules ship. **None of their cutoffs was fitted here**, and the model
says so rather than implying otherwise:

| provenance    | count | what it means                                                                |
| ------------- | ----- | ---------------------------------------------------------------------------- |
| `fitted`      | 0     | measured against this repository's corpus                                    |
| `borrowed`    | 5     | measured by jev-lint on its fixtures, against the same question              |
| `placeholder` | 12    | never measured; the number only decides whether a candidate is worth showing |

```ts
calibration: "borrowed",
calibrationSource: "jev-lint@af58a3b rules/typescript/test-mocks-subject/rule.yml",
threshold: 0.3,
```

**Only `fitted` can produce a violation.** A borrowed cutoff was measured on a
different corpus; a placeholder was never measured at all. Both run, both appear
as candidates, and neither turns an exit code. `--fitted-only` drops everything
that is not fitted, which on today's tree means everything: printing that is
better than running seventeen borrowed thresholds as though they were ours.

The five borrowed rules carry jev-lint's sentence, criteria **and note**
verbatim, because the cutoff was fitted against all three together. jev-lint
records that the note for `test-name-verifies-claim` moved label-only snapshot
cleans from 0.50-0.55 to 0.32-0.41 while holding the defects at 0.55-0.76: a
cutoff belongs to the question, not to the sentence alone. `note` is part of the
payload and part of the cache key for that reason.

The twelve new rules carry no note and ship with `calibration: "placeholder"`.
Each is gated by a fact so it asks only where the question can be answered:

| rule                              | asked of                                   |
| --------------------------------- | ------------------------------------------ |
| `test-asserts-something`          | tests with no assertion                    |
| `test-asserts-the-outcome`        | tests whose assertions are call checks     |
| `test-assertion-is-not-trivial`   | tests comparing a value with itself        |
| `test-is-not-abandoned`           | tests carrying a skip marker               |
| `test-waits-for-the-event`        | tests that sleep                           |
| `test-structure-is-flat`          | assertions under a loop or conditional     |
| `test-name-is-a-specification`    | every named test                           |
| `test-name-is-unique`             | tests whose name occurs twice in the file  |
| `test-does-not-mock-what-it-owns` | tests that install a double                |
| `test-cleans-up-its-doubles`      | tests that install a double with no hooks  |
| `test-is-deterministic`           | tests reading a clock, randomness or an id |
| `unit-test-has-no-io`             | tests touching the filesystem or network   |

One of jev-lint's test rules is deliberately absent. `tests-cover-failure-paths`
pairs a function with the tests that reach it, which is a subject shape v0.1
does not have; shipping it as a test rule would judge the wrong thing.

### Fitting a cutoff

`jev-lint gaps` first: a rule whose answers are bunched together has no cutoff
that helps, and the sentence needs rewriting. Then labels, then a fit, then the
same fit again to see how far it moves. A cutoff is a claim about one corpus,
and the provenance field is what keeps the claim checkable.

## Open questions

- Does Jev answer meaningfully on Ruby and Elixir, where no fixture exists yet?
  Unmeasured. Not in v0.1.
- Should `explain` labels be standardised across rules so findings can be
  aggregated by reason? Deferred until there are enough findings to aggregate.
- Is a file-level fallback (`subjectSource: "file"`) ever useful, or always
  noise? Measure on a language without a vocabulary before shipping it.
- Python's `def test_*` convention is ambiguous in production code: a helper
  named `test_connection` is not a test. Extraction reports `subjectSource:
  "test"` for it today. Measure the noise on a real repository before deciding
  whether to require a pytest import or an assertion fact.

## Units

Each unit's `verify` is the narrowest command that fails when the unit
regresses.

| Unit                | Acceptance                                                                                                                                                     | Verify                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `plugin-loader`     | A plugin declaring `model` is refused under `--deterministic`; the key is absent from `process.env` when plugin code runs                                      | `vp test tests/plugin.test.ts`            |
| `vocab-loader`      | A user vocabulary overrides a shipped one; a duplicate id is a load error, not a silent shadow                                                                 | `vp test tests/vocab.test.ts`             |
| `extract-ts`        | Test count and name/body agree with `vp test list` on the fixture suite                                                                                        | `vp test tests/extract-ts.test.ts`        |
| `extract-python`    | Agrees with `pytest --collect-only -q`                                                                                                                         | `vp test tests/extract-python.test.ts`    |
| `extract-go`        | Agrees with `go test -list '.*'`                                                                                                                               | `vp test tests/extract-go.test.ts`        |
| `extract-rust`      | Agrees with `cargo test -- --list`, doc tests excluded; approximate cases assert `subjectSource: "function"`                                                   | `vp test tests/extract-rust.test.ts`      |
| `extract-in-source` | In-source tests are found in production files for TypeScript and Rust; the guard is not counted as test logic; a test in `mod tests` inside an `impl` is found | `vp test tests/extract-in-source.test.ts` |
| `judge-and-cache`   | Two runs with the same input hit the cache and print identical findings; changing a fact invalidates the entry                                                 | `vp test tests/judge.test.ts`             |
| `gate-and-report`   | `missing` never reads as clean; `--fail-on error` does not fail on a warning                                                                                   | `vp test tests/gate.test.ts`              |
| `rules-ported`      | Each ported rule reproduces its jev-lint fixture decisions at the ported cutoff                                                                                | `test-lint eval --replay`                 |
| `rules-new`         | Each new rule separates its canary set; precision and recall in the README                                                                                     | `test-lint eval --replay`                 |
| `canary`            | A rule that detects nothing fails the canary rather than passing quietly                                                                                       | `vp test tests/canary.test.ts`            |
