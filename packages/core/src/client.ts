/**
 * The only place that talks to the model.
 *
 * A rule cannot reach it: the client is handed to `run`, and a rule only ever
 * sees `ctx.judge`. That is what keeps pacing, retry, splitting and spend in
 * one place, and what makes "the key never reaches rule code" true by
 * construction rather than by discipline.
 *
 * Two failures are recoverable and they are different:
 *
 * - `too_big` -- the server refused the request size. The only recovery is to
 *   send fewer questions, so `ask` halves the set and recurses.
 * - a 429 -- the server said "not now". Pacing is the real fix and is not
 *   implemented yet; what is here is a bounded wait and retry, counted apart
 *   from `retries` so a busy account does not look like a broken one.
 */
import { safeParse } from "valibot";
import { AnswerSchema } from "./schema.ts";
import { estimateTokens } from "./estimate.ts";
import type { Question } from "./question.ts";
import type { Answer } from "./types.ts";

export const API_KEY_VARS = ["TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY"] as const;
export const BASE_URL_VARS = ["TYPESAFE_BASE_URL", "TYPESAFEAI_BASE_URL"] as const;
export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";
/** Published input price, USD per million tokens. Output is not billed. */
export const USD_PER_MTOK = 0.042;

export type JevErrorKind = "too_big" | "auth" | "transient" | "rate_limited" | "other";

export class JevError extends Error {
  readonly kind: JevErrorKind;
  readonly status: number;

  constructor(message: string, options: { kind?: JevErrorKind; status?: number } = {}) {
    super(message);
    this.name = "JevError";
    this.kind = options.kind ?? "other";
    this.status = options.status ?? 0;
  }
}

export interface AskRequest {
  state: string;
  /**
   * Questions keyed by their own id, because that is the shape the endpoint
   * takes: a JSON array is refused with "Input should be a valid dictionary".
   * A real request is the only thing that told us this.
   */
  questions: Record<string, Question>;
}

export interface AskResponse {
  answers: Record<string, unknown>;
  usage: { input_tokens: number };
}

/** What `run` needs from a client. A test hands in one that never leaves the process. */
export interface AskClient {
  ask(request: AskRequest): Promise<AskResponse>;
}

export interface Spend {
  requests: number;
  inputTokens: number;
  rateLimited: number;
  usd: number;
}

export interface JevOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  retries?: number;
  rateLimitRetries?: number;
  rateLimitWaitMs?: number;
  timeoutMs?: number;
  transport?: typeof fetch;
  /** Called with the request body before it is sent, for leak assertions. */
  onRequest?: ((body: string) => void) | null;
}

export class JevClient implements AskClient {
  readonly spend: Spend = { requests: 0, inputTokens: 0, rateLimited: 0, usd: 0 };
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly retries: number;
  private readonly rateLimitRetries: number;
  private readonly rateLimitWaitMs: number;
  private readonly timeoutMs: number;
  private readonly transport: typeof fetch;
  private readonly onRequest: ((body: string) => void) | null;

  constructor(options: JevOptions = {}) {
    const key = options.apiKey ?? fromEnv(API_KEY_VARS);
    if (key === null) {
      throw new JevError(`no API key: set ${API_KEY_VARS.join(" or ")}`, { kind: "auth" });
    }
    this.apiKey = key;
    this.baseUrl = options.baseUrl ?? fromEnv(BASE_URL_VARS) ?? DEFAULT_BASE_URL;
    this.model = options.model ?? DEFAULT_MODEL;
    this.retries = options.retries ?? 3;
    this.rateLimitRetries = options.rateLimitRetries ?? 8;
    this.rateLimitWaitMs = options.rateLimitWaitMs ?? 300;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.transport = options.transport ?? fetch;
    this.onRequest = options.onRequest ?? null;
  }

  async ask(request: AskRequest): Promise<AskResponse> {
    const names = Object.keys(request.questions);
    if (names.length === 0) return { answers: {}, usage: { input_tokens: 0 } };
    try {
      return await this.post(request);
    } catch (error) {
      // The server refused the size, so the only recovery is fewer questions.
      // A single question cannot be split, and that is a real failure.
      if (error instanceof JevError && error.kind === "too_big" && names.length > 1) {
        const half = Math.ceil(names.length / 2);
        const first = await this.ask({
          state: request.state,
          questions: pick(request.questions, names.slice(0, half)),
        });
        const second = await this.ask({
          state: request.state,
          questions: pick(request.questions, names.slice(half)),
        });
        return {
          answers: { ...first.answers, ...second.answers },
          usage: { input_tokens: first.usage.input_tokens + second.usage.input_tokens },
        };
      }
      throw error;
    }
  }

  private async post(request: AskRequest): Promise<AskResponse> {
    const body = JSON.stringify({
      model: this.model,
      state: request.state,
      questions: request.questions,
    });
    this.onRequest?.(body);
    const estimated = estimateTokens(body);
    let attempt = 0;
    let limited = 0;

    for (;;) {
      const res = await this.send(body);
      if (res.status === 429) {
        limited += 1;
        this.spend.rateLimited += 1;
        if (limited > this.rateLimitRetries) {
          throw new JevError("rate limited, out of retries", { kind: "rate_limited", status: 429 });
        }
        await sleep(this.rateLimitWaitMs * 1.5 ** (limited - 1) * (0.75 + Math.random() / 2));
        continue;
      }

      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text) as AskResponse;
        this.spend.requests += 1;
        this.spend.inputTokens += parsed.usage?.input_tokens ?? estimated;
        this.spend.usd = (this.spend.inputTokens / 1_000_000) * USD_PER_MTOK;
        return parsed;
      }

      const kind = classify(res.status, text);
      if (kind === "transient" && attempt < this.retries) {
        attempt += 1;
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw new JevError(`${res.status}: ${text.slice(0, 200)}`, { kind, status: res.status });
    }
  }

  private async send(body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.transport(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      throw new JevError(`network: ${String(error).slice(0, 200)}`, { kind: "transient" });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** What the caller can do about a failure. */
export function classify(status: number, body: string): JevErrorKind {
  if (status === 400 && body.includes("max_tokens_exceeded")) return "too_big";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient";
  return "other";
}

/** First of these variables that is set and non-empty. */
export function fromEnv(names: readonly string[], env = process.env): string | null {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * The key is read here and then removed from the environment, so rule code
 * loaded afterwards cannot find it even though it runs in this process.
 */
export function takeKeyFromEnv(env = process.env): string | null {
  const key = fromEnv(API_KEY_VARS, env);
  for (const name of API_KEY_VARS) delete env[name];
  return key;
}

/**
 * Read an answer back, against the schema rather than by duck-typing.
 *
 * An answer outside 0..1, or of a type this build does not know, must reach the
 * gate as `missing`: a value read loosely is a verdict nobody can defend.
 */
export function readAnswer(
  answers: Record<string, unknown> | undefined,
  id: string,
): Answer | null {
  const parsed = safeParse(AnswerSchema, answers?.[id]);
  if (!parsed.success) return null;
  return parsed.output.type === "noul"
    ? { value: parsed.output.noul, confidence: null, kind: "noul" }
    : { value: parsed.output.score, confidence: parsed.output.confidence ?? null, kind: "score" };
}

/** The named subset of a question record, keeping the ids. */
function pick(questions: Record<string, Question>, names: string[]): Record<string, Question> {
  return Object.fromEntries(names.map((n) => [n, questions[n]!]));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------ tests

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest;
  const { buildQuestion } = await import("./question.ts");
  const { rule, subject } = await import("./testing/builders.ts");
  const fixture = subject();
  // The endpoint takes a dictionary keyed by question id, not an array.
  const questions = (n: number): Record<string, ReturnType<typeof buildQuestion>> =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `q${i}`,
        buildQuestion(rule(), { ...fixture, name: `t${i}` }, `q${i}`),
      ]),
    );

  const client = (transport: typeof fetch) =>
    new JevClient({ apiKey: "test", transport, rateLimitWaitMs: 1, retries: 1 });

  test("an answer comes back under the id it was asked with", async () => {
    const calls: string[] = [];
    const c = client(async (_url, init) => {
      calls.push(typeof init?.body === "string" ? init.body : "");
      return new Response(
        JSON.stringify({
          answers: { q0: { type: "noul", noul: 0.8 } },
          usage: { input_tokens: 120 },
        }),
        { status: 200 },
      );
    });
    const res = await c.ask({ state: "", questions: questions(1) });
    expect(readAnswer(res.answers, "q0")?.value).toBe(0.8);
    expect(c.spend.inputTokens).toBe(120);
    expect(calls).toHaveLength(1);
  });

  test("the key travels in the header and never in the body", async () => {
    const seen: Record<string, unknown> = {};
    const key = "sk-live-7f3a9c";
    const c = new JevClient({
      apiKey: key,
      transport: async (_url, init) => {
        seen.headers = init?.headers;
        seen.body = init?.body;
        return new Response(JSON.stringify({ answers: {}, usage: { input_tokens: 1 } }), {
          status: 200,
        });
      },
    });
    await c.ask({ state: "", questions: questions(1) });
    expect(JSON.stringify(seen.headers)).toContain(`Bearer ${key}`);
    // A body is what gets logged for a leak assertion, so the key must not be
    // in it even as a substring of something else.
    const sent = typeof seen.body === "string" ? seen.body : "";
    expect(sent).not.toContain("7f3a9c");
  });

  test("a 429 is waited out and sent again, counted apart from retries", async () => {
    let n = 0;
    const c = client(async () => {
      n += 1;
      if (n === 1) return new Response("slow down", { status: 429 });
      return new Response(
        JSON.stringify({
          answers: { q0: { type: "noul", noul: 0.5 } },
          usage: { input_tokens: 10 },
        }),
        { status: 200 },
      );
    });
    const res = await c.ask({ state: "", questions: questions(1) });
    expect(readAnswer(res.answers, "q0")?.value).toBe(0.5);
    expect(c.spend.rateLimited).toBe(1);
  });

  test("a refused request size is halved until it fits", async () => {
    const sizes: number[] = [];
    const c = client(async (_url, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        questions: Record<string, unknown>;
      };
      const names = Object.keys(body.questions);
      sizes.push(names.length);
      if (names.length > 2) {
        return new Response("max_tokens_exceeded", { status: 400 });
      }
      const answers = Object.fromEntries(names.map((n) => [n, { type: "noul", noul: 0.4 }]));
      return new Response(JSON.stringify({ answers, usage: { input_tokens: 5 } }), { status: 200 });
    });
    const res = await c.ask({ state: "", questions: questions(4) });
    expect(sizes[0]).toBe(4);
    expect(sizes).toContain(2);
    expect(Object.keys(res.answers)).toHaveLength(4);
  });

  test("an auth failure is not retried", async () => {
    let n = 0;
    const c = client(async () => {
      n += 1;
      return new Response("nope", { status: 401 });
    });
    await expect(c.ask({ state: "", questions: questions(1) })).rejects.toMatchObject({
      kind: "auth",
    });
    expect(n).toBe(1);
  });

  test("an unusable answer reads as null rather than as a value", () => {
    // A missing verdict must reach the gate as missing, never as clean.
    expect(readAnswer({ q0: { type: "score", noul: 0.9 } }, "q0")).toBeNull();
    expect(readAnswer({}, "q0")).toBeNull();
  });

  test("the key is removed from the environment before any rule could read it", () => {
    const env = { TYPESAFE_API_KEY: "secret" } as NodeJS.ProcessEnv;
    expect(takeKeyFromEnv(env)).toBe("secret");
    expect(env.TYPESAFE_API_KEY).toBeUndefined();
  });
}
