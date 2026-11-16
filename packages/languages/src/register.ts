/**
 * The grammars `@ast-grep/napi` does not ship.
 *
 * The native binding carries five (Html, JavaScript, Tsx, Css, TypeScript).
 * Everything else is a `@ast-grep/lang-*` package: a compiled tree-sitter
 * parser, registered once per process. Registration is global, so this module is
 * imported for its side effect and the guard keeps it idempotent.
 */
import { parse, registerDynamicLanguage } from "@ast-grep/napi";
import type { SgRoot } from "@ast-grep/napi";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import rust from "@ast-grep/lang-rust";

let registered = false;

function register(): void {
  if (registered) return;
  registerDynamicLanguage({ python, rust, go });
  registered = true;
}

/** Parse with a grammar that had to be registered first. */
export function parseRegistered(language: "python" | "rust" | "go", source: string): SgRoot {
  register();
  return parse(language, source);
}
