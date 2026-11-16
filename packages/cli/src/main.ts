#!/usr/bin/env node
/**
 * The command line.
 *
 * `main(argv, deps)` takes the model client and the two output streams, so a
 * test runs a command exactly as the terminal would, with a client that answers
 * without a network. `--dry-run` never constructs a client at all, which is what
 * makes pricing a run possible with no key.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  blocks,
  buildQuestion,
  Cache,
  formatAgent,
  estimateTokens,
  extract,
  JevClient,
  JevError,
  questionId,
  run,
  takeKeyFromEnv,
  USD_PER_MTOK,
  type AskClient,
  type LanguageDefinition,
  type Rule,
  type RunResult,
  type TestSubject,
} from "@test-lint/core";
import { LANGUAGES, languageFor } from "@test-lint/languages";
import { BUILTIN_RULES } from "@test-lint/rules";
import { formatGithub, formatJson, formatPretty } from "@test-lint/core";

export interface Deps {
  client?: AskClient | null;
  out?: (line: string) => void;
  err?: (line: string) => void;
  cwd?: string;
}

const DEFAULT_CACHE = ".test-lint/cache.json";

/** How a run is printed. `agent` is the default: one JSON object per line. */
export type Format = "agent" | "json" | "github" | "pretty";

export interface Options {
  command: "check";
  paths: string[];
  format: Format;
  dryRun: boolean;
  fittedOnly: boolean;
  /** Where the verdict cache lives, or `none` to run without one. */
  cache: string;
  /** The evidence arm: `file` sends the implementation, `bare` does not. */
  arm: "file" | "bare";
  help: boolean;
}

const USAGE = `ntlint -- a linter for tests: one rule across languages, judged by a model

usage:
  ntlint check [paths...]        judge the tests under these paths (default: .)
  ntlint check --dry-run         what it would ask, and the price. No request.
  ntlint check                   findings as JSON lines, then a summary (default)
  ntlint check --format json     one JSON document
  ntlint check --pretty          for a terminal
  ntlint check --github          GitHub annotations
  ntlint check --fitted-only     drop every rule whose cutoff was not fitted here
  ntlint check --arm <arm>       file (default: send the implementation) | bare
  ntlint check --cache <path>    verdict cache (default ${DEFAULT_CACHE}; 'none' disables)

The key comes from the environment and from nowhere else. Node can load a file:
  node --env-file=.env packages/cli/src/main.ts check packages
`;

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "check",
    paths: [],
    format: "agent",
    dryRun: false,
    fittedOnly: false,
    cache: DEFAULT_CACHE,
    arm: "file",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "check") continue;
    if (arg === "--cache") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--cache needs a path or `none`");
      options.cache = next;
      i += 1;
      continue;
    }
    if (arg === "--format") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--format needs agent, json, github or pretty");
      if (!["agent", "json", "github", "pretty"].includes(next)) {
        throw new Error(`unknown format: ${next}`);
      }
      options.format = next as Format;
      i += 1;
      continue;
    }
    if (arg === "--arm") {
      const next = argv[i + 1];
      if (next !== "file" && next !== "bare") throw new Error("--arm needs file or bare");
      options.arm = next;
      i += 1;
      continue;
    }
    if (arg === "--json") options.format = "json";
    else if (arg === "--github") options.format = "github";
    else if (arg === "--pretty") options.format = "pretty";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--fitted-only") options.fittedOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.paths.push(arg);
  }
  if (options.paths.length === 0) options.paths.push(".");
  return options;
}

/** Every file a language claims, under every path asked for. */
export function collectFiles(
  paths: string[],
  languages: readonly LanguageDefinition[],
  cwd: string,
): Array<{ file: string; language: LanguageDefinition }> {
  const out: Array<{ file: string; language: LanguageDefinition }> = [];
  const visit = (path: string) => {
    const full = join(cwd, path);
    if (!exists(full)) return;
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full)) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
        visit(join(path, entry));
      }
      return;
    }
    const language = languageFor(full, languages);
    if (language !== null) out.push({ file: path, language });
  };
  for (const path of paths) visit(path);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const cwd = deps.cwd ?? process.cwd();

  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err((error as Error).message);
    err(USAGE);
    return 2;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }

  // The key leaves the environment before any rule code is reached.
  const key = takeKeyFromEnv();
  const rules = loadRuleSet(options.fittedOnly);
  if (rules.length === 0) {
    err("no rules: every cutoff is borrowed or a placeholder, and --fitted-only was passed");
    return 2;
  }

  const files = collectFiles(options.paths, LANGUAGES, cwd);
  const subjects = files.flatMap(({ file, language }) => extractFile(file, language, cwd));

  if (options.dryRun) {
    // Price the run by building the questions it would send. No request is made,
    // and the estimate is the one the client uses, so the quote and the bill
    // come from the same arithmetic. The state travels once per file.
    let tokens = 0;
    let count = 0;
    for (const [file, group] of groupByFile(subjects)) {
      const asked = group.flatMap((subject) =>
        rules
          .filter((rule) => rule.gate === null || rule.gate(subject))
          .map((rule) => buildQuestion(rule, subject, questionId(0))),
      );
      count += asked.length;
      const state = options.arm === "file" ? (fileText(cwd, file) ?? "") : "";
      for (let i = 0; i < asked.length; i += 64) {
        tokens += estimateTokens(JSON.stringify({ state, questions: asked.slice(i, i + 64) }));
      }
    }
    const usd = (tokens / 1_000_000) * USD_PER_MTOK;
    out(`${subjects.length} test(s) in ${files.length} file(s); ${count} question(s)`);
    out(
      `about ${tokens.toLocaleString()} input tokens, $${usd.toFixed(4)} at $${USD_PER_MTOK}/Mtok`,
    );
    out("no request was made (--dry-run)");
    return 0;
  }

  if (deps.client == null && key === null) {
    err("no API key: set TYPESAFE_API_KEY (node --env-file=.env loads one), or run --dry-run");
    return 2;
  }
  const client = deps.client ?? new JevClient({ apiKey: key });
  const cache = options.cache === "none" ? null : readCache(join(cwd, options.cache));

  let result;
  try {
    result = await run({
      subjects,
      rules,
      client,
      cache: cache ?? undefined,
      arm: options.arm,
      fileText: (file) => {
        try {
          return readFileSync(join(cwd, file), "utf-8");
        } catch {
          return null;
        }
      },
    });
  } catch (error) {
    // A configuration or auth failure is a message, not a stack: retrying does
    // not help and the stack buries the reason.
    err(error instanceof JevError ? `ntlint: ${error.message}` : String(error));
    return 2;
  }

  if (cache !== null) writeCache(join(cwd, options.cache), cache);
  out(FORMATTERS[options.format](result));
  for (const failure of result.failures) err(`failed request: ${failure}`);
  // A run that could not ask is not a clean repository. In CI this is the
  // difference between "no findings" and "the key expired two months ago".
  if (result.failures.length > 0 || result.stats.missing > 0) {
    err(
      `${result.stats.missing} verdict(s) missing: the run did not complete, so it is not a pass`,
    );
    return 2;
  }
  return blocks(result.findings, null) ? 1 : 0;
}

/** The verdict cache: answers, so a second run over the same tree costs nothing. */
function readCache(path: string): Cache {
  try {
    return new Cache(JSON.parse(readFileSync(path, "utf-8")) as Record<string, never>);
  } catch {
    return new Cache();
  }
}

function writeCache(path: string, cache: Cache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache.toJSON(), null, 2));
  } catch {
    // A cache that cannot be written is a slower next run, not a failed one.
  }
}

const FORMATTERS: Record<Format, (result: RunResult) => string> = {
  agent: formatAgent,
  json: formatJson,
  github: formatGithub,
  pretty: formatPretty,
};

function loadRuleSet(fittedOnly: boolean): Rule[] {
  // A rule that needs a capability no vocabulary declares is dropped, and the
  // reason is printed by `--dry-run` once that exists.
  return fittedOnly ? BUILTIN_RULES.filter((r) => r.calibration === "fitted") : [...BUILTIN_RULES];
}

function groupByFile(subjects: TestSubject[]): Map<string, TestSubject[]> {
  const groups = new Map<string, TestSubject[]>();
  for (const subject of subjects) {
    const list = groups.get(subject.file) ?? [];
    list.push(subject);
    groups.set(subject.file, list);
  }
  return groups;
}

function fileText(cwd: string, file: string): string | null {
  try {
    return readFileSync(join(cwd, file), "utf-8");
  } catch {
    return null;
  }
}

function extractFile(file: string, language: LanguageDefinition, cwd: string): TestSubject[] {
  return extract(readFileSync(join(cwd, file), "utf-8"), file, language);
}

if (import.meta.vitest) {
  const { expect, test } = await import("vite-plus/test");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "test-lint-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src", "cart.test.ts"),
      'it("applies the discount", () => { expect(apply(cart)).toBe(90); });\n',
    );
    writeFileSync(join(dir, "src", "notes.md"), "# not a test file\n");
    return dir;
  }

  test("a dry run prices the work and makes no request", async () => {
    const lines: string[] = [];
    const code = await main(["check", "src", "--dry-run"], {
      out: (l) => lines.push(l),
      cwd: repo(),
    });
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain("1 test(s) in 1 file(s)");
    // "Prices the work" is in the name, so the price is what is checked.
    expect(output).toMatch(/about [\d,]+ input tokens, \$\d+\.\d{4}/);
    expect(output).toContain("no request was made");
  });

  test("reads only the files a language claims", async () => {
    const dir = repo();
    const files = collectFiles(["src"], LANGUAGES, dir);
    expect(files.map((f) => f.file)).toEqual([join("src", "cart.test.ts")]);
  });

  test("no key and no client is a message, not a crash", async () => {
    const errors: string[] = [];
    const code = await main(["check", "src"], { err: (l) => errors.push(l), cwd: repo() });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("no API key");
  });

  test("a run that could not ask exits 2 rather than 0", async () => {
    // Otherwise an expired key looks exactly like a clean repository.
    const errors: string[] = [];
    const failing = {
      ask: async () => {
        throw new Error("401");
      },
    };
    const code = await main(["check", "src"], {
      out: () => {},
      err: (l) => errors.push(l),
      client: failing,
      cwd: repo(),
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("did not complete");
  });

  test("prints one JSON document when --json is passed", async () => {
    const lines: string[] = [];
    const client = {
      ask: async ({ questions }: { questions: Record<string, unknown> }) => ({
        answers: Object.fromEntries(
          Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.99 }]),
        ),
        usage: { input_tokens: 10 },
      }),
    };
    const code = await main(["check", "src", "--json"], {
      out: (l) => lines.push(l),
      client,
      cwd: repo(),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as { findings: Array<Record<string, unknown>> };
    // Every rule is borrowed or a placeholder, so nothing is a violation yet.
    expect(parsed.findings.every((f) => f.messageId === "candidate")).toBe(true);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });
}

/**
 * Run only when invoked as a program: the tests import this module.
 *
 * `process.argv[1]` is the path that was executed, and a package manager runs a
 * bin through a symlink in `node_modules/.bin`, while `import.meta.url` is the
 * real file. Comparing them without resolving the link made the installed
 * command exit 0 and print nothing -- a published binary that does nothing is a
 * bug only a real install finds.
 */
function invokedAsProgram(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedAsProgram()) process.exitCode = await main(process.argv.slice(2));
