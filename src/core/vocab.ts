/**
 * Loading a vocabulary, and refusing one that is wrong.
 *
 * Two rules here, both learned from jev-lint's config loader:
 *
 * - **An unknown key is an error.** A misspelt `assesrt:` that loads silently
 *   means every test in that language is judged as though it never asserted
 *   anything. The message names the key, because "invalid vocabulary" sends the
 *   author through the whole file.
 * - **A duplicate name is an error, and names both files.** A user vocabulary
 *   overriding a shipped one is deliberate and must win visibly; two
 *   vocabularies for one language is a merge nobody can reason about, and a
 *   silent precedence rule is the worst of the three.
 */
import { parse } from "yaml";
import { VOCAB_CAPABILITIES } from "./types.ts";
import type {
  Capability,
  Guard,
  Predicate,
  Vocab,
  VocabSkip,
  VocabStructure,
  VocabTest,
} from "./types.ts";

export class VocabError extends Error {
  readonly source: string;

  constructor(message: string, source: string) {
    super(`${source}: ${message}`);
    this.name = "VocabError";
    this.source = source;
  }
}

const TOP_KEYS = new Set([
  "name",
  "grammars",
  "test",
  "structure",
  "assert",
  "double",
  "sleep",
  "skip",
  "hooks",
  "snapshot",
  "async",
]);
const TEST_KEYS = new Set(["utils", "marker", "container", "guard"]);
const GUARD_KEYS = new Set(["kind", "condition", "attribute"]);
const STRUCTURE_KEYS = new Set(["loop", "conditional", "try", "call"]);
const PREDICATE_KEYS = new Set(["shape", "callee", "keyword", "importedFrom"]);
const SKIP_KEYS = new Set(["marker", "modifiers"]);

const SHAPES = ["call", "method", "macro", "statement"] as const;

/** Read one vocabulary. Throws `VocabError` rather than returning a partial one. */
export function parseVocab(text: string, source: string): Vocab {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new VocabError(`not valid YAML: ${(error as Error).message}`, source);
  }
  const root = record(data, "vocabulary", source);
  rejectUnknown(root, TOP_KEYS, "", source);

  const name = string(root.name, "name", source);
  const grammars = strings(root.grammars, "grammars", source);
  if (grammars.length === 0)
    throw new VocabError("grammars: at least one grammar is required", source);

  return {
    name,
    grammars,
    source,
    test: parseTest(root.test, source),
    structure: parseStructure(root.structure, source),
    assert: predicates(root.assert, "assert", source),
    double: predicates(root.double, "double", source),
    sleep: predicates(root.sleep, "sleep", source),
    skip: parseSkip(root.skip, source),
    hooks: predicates(root.hooks, "hooks", source),
    snapshot: boolean(root.snapshot, "snapshot", source, false),
    async: boolean(root.async, "async", source, false),
  };
}

/** What this vocabulary can be asked about, in the canonical order. */
export function derivedCapabilities(vocab: Vocab): Capability[] {
  const has = (list: Predicate[]) => list.length > 0;
  const declared: Record<(typeof VOCAB_CAPABILITIES)[number], boolean> = {
    test:
      vocab.test.utils.length > 0 || vocab.test.marker !== null || vocab.test.container !== null,
    assert: has(vocab.assert),
    skip: vocab.skip.marker !== null || vocab.skip.modifiers.length > 0,
    sleep: has(vocab.sleep),
    doubles: has(vocab.double),
    hooks: has(vocab.hooks),
    snapshot: vocab.snapshot,
    async: vocab.async,
  };
  return VOCAB_CAPABILITIES.filter((c) => declared[c]);
}

/**
 * Shipped vocabularies, with user ones laid over them by name.
 *
 * The order is the shipped order, so a report does not reshuffle when a user
 * adds a language; a user-only vocabulary is appended.
 */
export function mergeVocabs(shipped: Vocab[], user: Vocab[]): Vocab[] {
  rejectDuplicates(user, "user");
  rejectDuplicates(shipped, "shipped");
  const byName = new Map(user.map((v) => [v.name, v]));
  const merged = shipped.map((v) => byName.get(v.name) ?? v);
  const shippedNames = new Set(shipped.map((v) => v.name));
  for (const v of user) if (!shippedNames.has(v.name)) merged.push(v);
  return merged;
}

function rejectDuplicates(vocabs: Vocab[], which: string): void {
  const seen = new Map<string, Vocab>();
  for (const v of vocabs) {
    const first = seen.get(v.name);
    if (first !== undefined) {
      throw new VocabError(
        `two ${which} vocabularies for "${v.name}": ${first.source} and ${v.source}`,
        v.source,
      );
    }
    seen.set(v.name, v);
  }
}

function parseTest(value: unknown, source: string): VocabTest {
  const test = record(value, "test", source);
  rejectUnknown(test, TEST_KEYS, "test.", source);
  const utils = strings(test.utils, "test.utils", source);
  const marker = optionalString(test.marker, "test.marker", source);
  const container = optionalString(test.container, "test.container", source);
  if (utils.length === 0 && marker === null && container === null) {
    throw new VocabError(
      "test: needs one of utils, marker or container, or nothing can be found",
      source,
    );
  }
  return { utils, marker, container, guard: guards(test.guard, source) };
}

function parseStructure(value: unknown, source: string): VocabStructure {
  const s = value === undefined ? {} : record(value, "structure", source);
  rejectUnknown(s, STRUCTURE_KEYS, "structure.", source);
  return {
    loop: strings(s.loop, "structure.loop", source),
    conditional: strings(s.conditional, "structure.conditional", source),
    try: strings(s.try, "structure.try", source),
    call: strings(s.call, "structure.call", source),
  };
}

function parseSkip(value: unknown, source: string): VocabSkip {
  if (value === undefined) return { marker: null, modifiers: [] };
  const s = record(value, "skip", source);
  rejectUnknown(s, SKIP_KEYS, "skip.", source);
  return {
    marker: optionalString(s.marker, "skip.marker", source),
    modifiers: strings(s.modifiers, "skip.modifiers", source),
  };
}

function guards(value: unknown, source: string): Guard[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new VocabError("test.guard: expected a list", source);
  return value.map((g, i) => {
    const where = `test.guard[${i}]`;
    const guard = record(g, where, source);
    rejectUnknown(guard, GUARD_KEYS, `${where}.`, source);
    return {
      kind: string(guard.kind, `${where}.kind`, source),
      condition: optionalString(guard.condition, `${where}.condition`, source),
      attribute: optionalString(guard.attribute, `${where}.attribute`, source),
    };
  });
}

function predicates(value: unknown, key: string, source: string): Predicate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new VocabError(`${key}: expected a list`, source);
  return value.map((p, i) => {
    const where = `${key}[${i}]`;
    const predicate = record(p, where, source);
    rejectUnknown(predicate, PREDICATE_KEYS, `${where}.`, source);
    const shape = optionalString(predicate.shape, `${where}.shape`, source) ?? "call";
    if (!(SHAPES as readonly string[]).includes(shape)) {
      throw new VocabError(
        `${where}.shape: expected one of ${SHAPES.join(", ")}, got "${shape}"`,
        source,
      );
    }
    const callee = optionalString(predicate.callee, `${where}.callee`, source);
    const keyword = optionalString(predicate.keyword, `${where}.keyword`, source);
    if (callee === null && keyword === null) {
      throw new VocabError(`${where}: needs callee or keyword`, source);
    }
    return {
      shape: shape as Predicate["shape"],
      callee,
      keyword,
      importedFrom: strings(predicate.importedFrom, `${where}.importedFrom`, source),
    };
  });
}

// ------------------------------------------------------------------ readers

function record(value: unknown, where: string, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VocabError(`${where}: expected a mapping`, source);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, where: string, source: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VocabError(`${where}: expected a non-empty string`, source);
  }
  return value;
}

function optionalString(value: unknown, where: string, source: string): string | null {
  return value === undefined || value === null ? null : string(value, where, source);
}

function strings(value: unknown, where: string, source: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new VocabError(`${where}: expected a list of strings`, source);
  return value.map((v, i) => string(v, `${where}[${i}]`, source));
}

function boolean(value: unknown, where: string, source: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new VocabError(`${where}: expected true or false`, source);
  return value;
}

function rejectUnknown(
  data: Record<string, unknown>,
  known: Set<string>,
  prefix: string,
  source: string,
): void {
  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      throw new VocabError(`unknown key "${prefix}${key}"`, source);
    }
  }
}
