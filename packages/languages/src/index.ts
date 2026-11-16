/**
 * The languages this build can read.
 *
 * A language is a module: adding one is a file and a line here, and a rule never
 * names a language at all.
 */
import type { LanguageDefinition } from "@test-lint/core";
import typescript from "./typescript.ts";

export const LANGUAGES: readonly LanguageDefinition[] = [typescript];

/** The language that claims a path, by extension. */
export function languageFor(path: string, languages = LANGUAGES): LanguageDefinition | null {
  const dot = path.lastIndexOf(".");
  const extension = dot === -1 ? "" : path.slice(dot);
  return languages.find((language) => language.extensions.includes(extension)) ?? null;
}
