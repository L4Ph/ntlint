/**
 * `import.meta.vitest` is replaced by Vitest when a module is loaded for a test
 * and is `undefined` otherwise. Declared optional so the guard narrows, which
 * is what makes an in-source block disappear from a normal import.
 */
interface ImportMeta {
  readonly vitest?: typeof import("vite-plus/test");
}
