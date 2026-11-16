/**
 * Small helpers three languages would otherwise each write.
 *
 * Nothing here decides anything: they read a field, walk up from a node, and
 * count. The rules that decide what a test or an assertion is live in the
 * language module, because that is the language's knowledge.
 */
import type { NapiConfig, SgNode } from "@ast-grep/napi";

/** The text of a node's named field, or the empty string when it has none. */
export function fieldText(node: SgNode, field: string): string {
  const child = node.field?.(field) as SgNode | null | undefined;
  return child?.text() ?? "";
}

/** The first identifier under a callee: `t.Fatal` -> `t`, `fs::read` -> `fs`. */
export function rootName(node: SgNode | null, field = "function"): string {
  if (node == null) return "";
  const child = node.field?.(field) as SgNode | null | undefined;
  if (child == null) return "";
  const kind = String(child.kind());
  if (kind === "identifier" || kind === "field_expression" || kind === "scoped_identifier") {
    return child.child(0)?.text() ?? child.text();
  }
  return child.text();
}

/** Every node matching a rule, under `node`. */
export function findAll(node: SgNode, config: NapiConfig): SgNode[] {
  return node.findAll(config);
}

/** A node's byte range: `SgNode` wrappers are not comparable by reference. */
export function nodeKey(node: SgNode): string {
  const range = node.range();
  return `${range.start.index}:${range.end.index}`;
}

/** Is `node` inside a node of one of these kinds, before reaching `stop`? */
export function isUnder(node: SgNode, stop: SgNode, kinds: string[]): boolean {
  const stopAt = nodeKey(stop);
  for (const ancestor of node.ancestors()) {
    if (nodeKey(ancestor) === stopAt) return false;
    if (kinds.includes(String(ancestor.kind()))) return true;
  }
  return false;
}
