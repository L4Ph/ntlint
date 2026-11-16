/**
 * Asking the model about every (test, rule) pair that survived its gate.
 *
 * The pipeline is one pass: a rule's `gate` drops the pairs where the question
 * cannot be answered, the cache answers the ones it has seen, and what is left
 * is packed into requests.
 *
 * **The state is the file.** A test body alone cannot answer "would this test
 * still pass if the named behaviour were broken": the behaviour is in the
 * implementation the test calls, and in this repository that implementation is
 * usually in the same file. Sending the test and nothing else made that question
 * unanswerable, and the model answered it anyway -- which is how a run produced
 * a candidate list that was mostly wrong.
 *
 * So questions are grouped by file, one request carries that file once, and each
 * question says which lines of it are the test. `--arm bare` exists for a rule
 * set that genuinely needs only the body, and its verdicts are cached apart.
 *
 * A request that fails is not a clean result: every pair in it becomes
 * `missing`, which the report counts and no exit code ignores.
 */
import { verdictKey, type Cache } from "./cache.ts";
import { readAnswer, type AskClient } from "./client.ts";
import { collect, decide, type GateResult } from "./gate.ts";
import { buildQuestion, questionId } from "./question.ts";
import type { Answer, Finding, Rule, TestSubject } from "./types.ts";

export interface RunOptions {
  subjects: readonly TestSubject[];
  rules: readonly Rule[];
  client: AskClient;
  cache?: Cache;
  /** The evidence arm. `file` is the default: the implementation is evidence. */
  arm?: string;
  /** The file's own text, for the state. Without it, the state is empty. */
  fileText?: ((file: string) => string | null) | null;
  /** How many questions one request may carry. */
  maxQuestions?: number;
  onProgress?: ((message: string) => void) | null;
}

export interface RunSpend {
  requests: number;
  inputTokens: number;
  usd: number;
}

export interface RunResult extends GateResult {
  spend: RunSpend;
  /** Answers served from the cache, so a second run over the same tree is free. */
  cached: number;
  /** Requests that failed, with their reason. Each one becomes `missing` findings. */
  failures: string[];
}

/** One question to ask, and what to do with its answer. */
interface Pair {
  rule: Rule;
  subject: TestSubject;
  key: string;
  answer: Answer | null;
}

export async function run(options: RunOptions): Promise<RunResult> {
  const { subjects, rules, client } = options;
  const arm = options.arm ?? "file";
  const maxQuestions = options.maxQuestions ?? 64;
  const cache = options.cache;

  const pairs: Pair[] = [];
  for (const subject of subjects) {
    for (const rule of rules) {
      // A test rule on a suite asks about assertions a suite does not have.
      const kind = subject.subjectSource === "suite" ? "suite" : "test";
      if (rule.subject !== "any" && rule.subject !== kind) continue;
      if (rule.gate !== null && !rule.gate(subject)) continue;
      const state = arm === "file" ? (options.fileText?.(subject.file) ?? "") : "";
      const key = verdictKey({ rule, subject, arm, state });
      const cached = cache?.get(key) ?? null;
      pairs.push({ rule, subject, key, answer: cached });
    }
  }

  const pending = pairs.filter((p) => p.answer === null);
  let cached = pairs.length - pending.length;
  const failures: string[] = [];
  let requests = 0;
  let inputTokens = 0;

  for (const batch of chunk(pending, Math.max(1, maxQuestions))) {
    const questions = Object.fromEntries(
      batch.map((pair, i) => [
        questionId(i),
        buildQuestion(pair.rule, pair.subject, questionId(i)),
      ]),
    );
    try {
      const response = await client.ask({ state: "", questions });
      requests += 1;
      inputTokens += response.usage.input_tokens;
      batch.forEach((pair, i) => {
        const answer = readAnswer(response.answers, questionId(i));
        pair.answer = answer;
        if (answer !== null) cache?.set(pair.key, answer);
      });
      options.onProgress?.(`asked ${batch.length} question(s) in one request`);
    } catch (error) {
      // One failed request is one batch of missing verdicts, not a clean batch.
      failures.push((error as Error).message);
    }
  }

  const findings: Finding[] = pairs.map((pair) => decide(pair.rule, pair.subject, pair.answer));
  return {
    ...collect(findings),
    spend: { requests, inputTokens, usd: (inputTokens / 1_000_000) * USD_PER_MTOK },
    cached,
    failures,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Kept here rather than imported from the client, so `run` stays testable without it. */
const USD_PER_MTOK = 0.042;

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { Cache } = await import("./cache.ts");
  const { rule, subject } = await import("./testing/builders.ts");

  // A test that asserts, and one that does not: the second is what a gate is for.
  const subjects = [
    subject(),
    subject({ name: "no assertion at all", facts: { ...subject().facts, assertions: 0 } }),
  ];

  /** Answers every question with one value, and counts the asks. */
  function stub(value: number) {
    const state = { calls: 0, questions: 0 };
    return {
      state,
      ask: async ({ questions }: { questions: Record<string, unknown> }) => {
        state.calls += 1;
        state.questions += Object.keys(questions).length;
        const answers = Object.fromEntries(
          Object.keys(questions).map((id) => [id, { type: "noul", noul: value }]),
        );
        return { answers, usage: { input_tokens: 100 } };
      },
    };
  }

  const fitted = () => rule({ calibration: "fitted", requires: ["model", "test"] });

  test("one request carries every outstanding question", async () => {
    const stubClient = stub(0.9);
    const result = await run({ subjects, rules: [fitted()], client: stubClient });
    expect(stubClient.state.calls).toBe(1);
    expect(stubClient.state.questions).toBe(2);
    expect(result.findings).toHaveLength(2);
    expect(result.spend.inputTokens).toBe(100);
  });

  test("a second run over the same tree asks nothing", async () => {
    // The cache is what makes a lint run in CI free, and what makes a
    // recalibration possible without a request.
    const cache = new Cache();
    const first = stub(0.9);
    await run({ subjects, rules: [fitted()], client: first, cache });
    const second = stub(0.9);
    const result = await run({ subjects, rules: [fitted()], client: second, cache });
    expect(second.state.calls).toBe(0);
    expect(result.cached).toBe(2);
  });

  test("a rule's gate spends no request where the question cannot be answered", async () => {
    const gated = rule({ calibration: "fitted", gate: (s) => s.facts.assertions === 0 });
    const stubClient = stub(0.9);
    const result = await run({ subjects, rules: [gated], client: stubClient });
    // Only the test with no assertion is asked.
    expect(stubClient.state.questions).toBe(1);
    expect(result.stats.subjects).toBe(1);
  });

  test("a failed request becomes missing verdicts, never a clean result", async () => {
    const failing = {
      ask: async () => {
        throw new Error("network down");
      },
    };
    const result = await run({ subjects, rules: [fitted()], client: failing });
    expect(result.findings).toHaveLength(0);
    expect(result.stats.missing).toBe(2);
    expect(result.failures).toEqual(["network down"]);
  });

  test("a test rule is never asked about a suite", async () => {
    // A suite carries tests, not assertions: every answer would be noise.
    const suite = subject({
      subjectSource: "suite",
      name: "cart",
      facts: { ...subject().facts, assertions: 0 },
    });
    const stubClient = stub(0.9);
    const result = await run({ subjects: [suite], rules: [fitted()], client: stubClient });
    expect(stubClient.state.questions).toBe(0);
    expect(result.stats.subjects).toBe(0);
  });

  test("questions are batched at the size the run asks for", async () => {
    const stubClient = stub(0.9);
    await run({ subjects, rules: [fitted()], client: stubClient, maxQuestions: 1 });
    expect(stubClient.state.calls).toBe(2);
  });
}
