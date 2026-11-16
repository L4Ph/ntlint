/**
 * Write one page per rule, because a finding names one.
 *
 * `docs/rules/<id>.md` is what every finding points at, so the file has to
 * exist: a 404 is a finding an agent cannot look up, which is the one thing the
 * rule loader calls a hard error. Generated rather than written by hand, so a
 * rule that changes its sentence cannot leave its page saying the old one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BUILTIN_RULES } from "../src/index.ts";

const dir = new URL("../../../docs/rules/", import.meta.url);
mkdirSync(dir, { recursive: true });

for (const rule of BUILTIN_RULES) {
  const when = rule.gate === null ? "every subject it is asked about" : "subjects its gate accepts";
  const page = `# ${rule.id}

**${rule.severity}** · ${rule.calibration}${rule.calibrationSource ? ` (${rule.calibrationSource})` : ""} · cutoff ${rule.threshold}

## What it asks

${rule.ask}
${rule.note ? `\n## What the answer must not read as\n\n${rule.note}\n` : ""}
## How the answer is read

**true** — ${rule.criteria?.true ?? ""}

**false** — ${rule.criteria?.false ?? ""}

## When it is asked

${when}. Judged subject: ${rule.subject}. Needs: ${rule.requires.join(", ") || "nothing"}.

A cutoff is a claim about one corpus. \`${rule.calibration}\` means ${
    rule.calibration === "fitted"
      ? "it was measured against this repository's corpus"
      : rule.calibration === "borrowed"
        ? "it was measured elsewhere, against the same question"
        : "it was never measured, so this rule can only report a candidate"
  }.
`;
  writeFileSync(new URL(`${rule.id}.md`, dir), page);
}
process.stdout.write(`wrote ${BUILTIN_RULES.length} rule pages\n`);
