/**
 * Write the JSON Schema an editor reads while a vocabulary is being written.
 *
 * Committed, and checked against the schema in `src/schema.ts` by a test, so a
 * field added to the valibot schema shows up as a failing test until this file
 * is regenerated. An editor validating with a stale schema is worse than none.
 */
import { writeFileSync } from "node:fs";
import { vocabJsonSchema } from "../src/schema.ts";

const url = new URL("../vocab/schema.json", import.meta.url);
writeFileSync(url, `${JSON.stringify(vocabJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${url.pathname}\n`);
