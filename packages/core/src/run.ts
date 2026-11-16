/**
 * Asking the model about every (test, rule) pair that survived its gate.
 *
 * The pipeline is one pass: a rule's `gate` drops the pairs where the question
 * cannot be answered, the cache answers the ones it has seen, and what is left
 * is packed into requests. State is empty for the `bare` arm -- the test's own
 * text travels in each question -- so a request is a bag of independent
 * questions and nothing in it depends on which test sits next to which.
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
  /** The evidence arm in force. `bare` is the default: the test is the question. */
  arm?: string;
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
  const arm = options.arm ?? "bare";
  const maxQuestions = options.maxQuestions ?? 64;
  const cache = options.cache;

  const pairs: Pair[] = [];
  for (const subject of subjects) {
    for (const rule of rules) {
      // A test rule on a suite asks about assertions a suite does not have.
      const kind = subject.subjectSource === "suite" ? "suite" : "test";
      if (rule.subject !== "any" && rule.subject !== kind) continue;
      if (rule.gate !== null && !rule.gate(subject)) continue;
      const key = verdictKey({ rule, subject, arm });
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
  const { parseVocab } = await import("./vocab.ts");
  const { extract } = await import("./extract.ts");
  const { readFileSync } = await import("node:fs");
  const { rule } = await import("./testing/builders.ts");
  const VOCAB = parseVocab(
    readFileSync(new URL("../vocab/typescript.yml", import.meta.url), "utf-8"),
    "vocab",
  );

  const SOURCE = `
it("applies the discount", () => { expect(apply(cart)).toBe(90); });
it("no assertion at all", () => {});
`;
  const subjects = extract(SOURCE, "a.test.ts", VOCAB);

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
    const suites = extract(
      'describe("cart", () => { it("a", () => { expect(1).toBe(2); }); });',
      "a.test.ts",
      VOCAB,
    );
    const stubClient = stub(0.9);
    const asTest = await run({ subjects: suites, rules: [fitted()], client: stubClient });
    // One test inside the suite, so one pair; the suite itself is not asked.
    expect(asTest.stats.subjects).toBe(1);
  });

  test("questions are batched at the size the run asks for", async () => {
    const stubClient = stub(0.9);
    await run({ subjects, rules: [fitted()], client: stubClient, maxQuestions: 1 });
    expect(stubClient.state.calls).toBe(2);
  });
}
