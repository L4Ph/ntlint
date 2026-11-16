#!/usr/bin/env node
/**
 * The command line.
 *
 * `main(argv, deps)` takes the model client and the two output streams, so a
 * test runs a command exactly as the terminal would, with a client that answers
 * without a network. `--dry-run` never constructs a client at all, which is what
 * makes pricing a run possible with no key.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  blocks,
  buildQuestion,
  estimateTokens,
  extract,
  JevClient,
  JevError,
  mergeVocabs,
  parseVocab,
  questionId,
  run,
  takeKeyFromEnv,
  USD_PER_MTOK,
  type AskClient,
  type Rule,
  type TestSubject,
  type Vocab,
} from "@test-lint/core";
import { BUILTIN_RULES } from "@test-lint/rules";
import { formatGithub, formatJson, formatPretty } from "@test-lint/core";

export interface Deps {
  client?: AskClient | null;
  out?: (line: string) => void;
  err?: (line: string) => void;
  cwd?: string;
}

export interface Options {
  command: "check";
  paths: string[];
  json: boolean;
  github: boolean;
  dryRun: boolean;
  fittedOnly: boolean;
  help: boolean;
}

const USAGE = `test-lint -- a linter for tests: one rule across languages, judged by a model

usage:
  test-lint check [paths...]        judge the tests under these paths (default: .)
  test-lint check --dry-run         what it would ask, and the price. No request.
  test-lint check --json            machine-readable findings
  test-lint check --github          GitHub annotations
  test-lint check --fitted-only     drop every rule whose cutoff was not fitted here

The key comes from the environment and from nowhere else. Node can load a file:
  node --env-file=.env packages/cli/src/main.ts check packages
`;

/** Extensions a vocabulary claims, by grammar. */
const EXTENSIONS: Record<string, string[]> = {
  TypeScript: [".ts", ".mts", ".cts"],
  Tsx: [".tsx"],
  JavaScript: [".js", ".mjs", ".cjs"],
  Jsx: [".jsx"],
};

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "check",
    paths: [],
    json: false,
    github: false,
    dryRun: false,
    fittedOnly: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "check") continue;
    if (arg === "--json") options.json = true;
    else if (arg === "--github") options.github = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--fitted-only") options.fittedOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.paths.push(arg);
  }
  if (options.paths.length === 0) options.paths.push(".");
  return options;
}

/** The vocabularies this run can use: shipped first, then the project's own. */
export function loadVocabs(cwd: string, vocabDir: string): Vocab[] {
  const shipped = readVocabDir(vocabDir);
  const userDir = join(cwd, ".test-lint", "vocab");
  return mergeVocabs(shipped, exists(userDir) ? readVocabDir(userDir) : []);
}

function readVocabDir(dir: string): Vocab[] {
  if (!exists(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => {
      const path = join(dir, f);
      return parseVocab(readFileSync(path, "utf-8"), relative(process.cwd(), path));
    });
}

/** Every file a vocabulary claims, under every path asked for. */
export function collectFiles(
  paths: string[],
  vocabs: Vocab[],
  cwd: string,
): Array<{ file: string; vocab: Vocab }> {
  const byExtension = new Map<string, Vocab>();
  for (const vocab of vocabs) {
    for (const grammar of vocab.grammars) {
      for (const ext of EXTENSIONS[grammar] ?? []) byExtension.set(ext, vocab);
    }
  }
  const out: Array<{ file: string; vocab: Vocab }> = [];
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
    const dot = full.lastIndexOf(".");
    const vocab = byExtension.get(full.slice(dot));
    if (vocab !== undefined) out.push({ file: path, vocab });
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
  const vocabs = loadVocabs(cwd, join(import.meta.dirname, "..", "..", "core", "vocab"));
  const rules = loadRuleSet(options.fittedOnly);
  if (rules.length === 0) {
    err("no rules: every cutoff is borrowed or a placeholder, and --fitted-only was passed");
    return 2;
  }

  const files = collectFiles(options.paths, vocabs, cwd);
  const subjects = files.flatMap(({ file, vocab }) => extractFile(file, vocab, cwd));

  if (options.dryRun) {
    // Price the run by building the questions it would send. No request is made,
    // and the estimate is the one the client uses, so the quote and the bill
    // come from the same arithmetic.
    const questions = subjects.flatMap((subject) =>
      rules
        .filter((rule) => rule.gate === null || rule.gate(subject))
        .map((rule) => buildQuestion(rule, subject, questionId(0))),
    );
    let tokens = 0;
    for (let i = 0; i < questions.length; i += 64) {
      tokens += estimateTokens(
        JSON.stringify({ state: "", questions: questions.slice(i, i + 64) }),
      );
    }
    const usd = (tokens / 1_000_000) * USD_PER_MTOK;
    out(`${subjects.length} test(s) in ${files.length} file(s); ${questions.length} question(s)`);
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

  let result;
  try {
    result = await run({ subjects, rules, client });
  } catch (error) {
    // A configuration or auth failure is a message, not a stack: retrying does
    // not help and the stack buries the reason.
    err(error instanceof JevError ? `test-lint: ${error.message}` : String(error));
    return 2;
  }

  out(
    options.json
      ? formatJson(result)
      : options.github
        ? formatGithub(result)
        : formatPretty(result),
  );
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

function loadRuleSet(fittedOnly: boolean): Rule[] {
  // A rule that needs a capability no vocabulary declares is dropped, and the
  // reason is printed by `--dry-run` once that exists.
  return fittedOnly ? BUILTIN_RULES.filter((r) => r.calibration === "fitted") : [...BUILTIN_RULES];
}

function extractFile(file: string, vocab: Vocab, cwd: string): TestSubject[] {
  return extract(readFileSync(join(cwd, file), "utf-8"), file, vocab);
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
    expect(lines.join("\n")).toContain("1 test(s) in 1 file(s)");
    expect(lines.join("\n")).toContain("no request was made");
  });

  test("a file no vocabulary claims is not read", async () => {
    const dir = repo();
    const vocabs = loadVocabs(dir, join(import.meta.dirname, "..", "..", "core", "vocab"));
    const files = collectFiles(["src"], vocabs, dir);
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

  test("findings come back in the shape the flag asked for", async () => {
    const lines: string[] = [];
    const client = {
      ask: async ({ questions }: { questions: unknown[] }) => ({
        answers: Object.fromEntries(
          questions.map((_, i) => [`q${String(i).padStart(4, "0")}`, { type: "noul", noul: 0.99 }]),
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

// Run only when invoked as a program: the tests import this module.
const invoked =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) process.exitCode = await main(process.argv.slice(2));
