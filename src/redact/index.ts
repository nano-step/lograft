import type {
  CorrelatedFindings,
  RedactionRule,
  RedactionRules,
  Row,
  FindingGroup,
} from "../types.js";
import {
  DEFAULT_REDACTION_RULES,
  defaultRedactionRules,
  compileRule,
} from "./default-rules.js";

export { DEFAULT_REDACTION_RULES, defaultRedactionRules };

export interface RedactOptions {
  rules?: RedactionRules;
  bypass?: boolean;
  warn?: (msg: string) => void;
}

export function buildCompiledRules(
  rules: RedactionRules,
): Array<{ regex: RegExp; replacement: string; name: string }> {
  return rules.rules.map((rule: RedactionRule) => ({
    regex: compileRule(rule),
    replacement: rule.replacement,
    name: rule.name,
  }));
}

export function redactString(
  text: string,
  compiled: ReturnType<typeof buildCompiledRules>,
): string {
  let result = text;
  for (const { regex, replacement } of compiled) {
    regex.lastIndex = 0;
    result = result.replace(regex, replacement);
  }
  return result;
}

function redactValue(
  value: unknown,
  compiled: ReturnType<typeof buildCompiledRules>,
): unknown {
  if (typeof value === "string") return redactString(value, compiled);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, compiled));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, compiled);
    }
    return out;
  }
  return value;
}

function redactRow(
  row: Row,
  compiled: ReturnType<typeof buildCompiledRules>,
): Row {
  return {
    timestamp: row.timestamp,
    level: row.level,
    message: redactString(row.message, compiled),
    source: row.source,
    raw: redactValue(row.raw, compiled) as Row["raw"],
  };
}

function redactGroup(
  group: FindingGroup,
  compiled: ReturnType<typeof buildCompiledRules>,
): FindingGroup {
  return {
    label: redactString(group.label, compiled),
    rows: group.rows.map((r) => redactRow(r, compiled)),
    links: group.links,
    evidence: group.evidence,
  };
}

export function redactFindings(
  findings: CorrelatedFindings,
  opts: RedactOptions = {},
): CorrelatedFindings {
  if (opts.bypass) {
    opts.warn?.(
      "[lograft] WARNING: redaction bypassed. Output may contain PII — do NOT paste into public tickets.",
    );
    return findings;
  }

  const rules = opts.rules ?? defaultRedactionRules;
  const compiled = buildCompiledRules(rules);

  return {
    summary: {
      headline: redactString(findings.summary.headline, compiled),
      severity: findings.summary.severity,
      bullets: findings.summary.bullets.map((b) => redactString(b, compiled)),
    },
    groups: findings.groups.map((g) => redactGroup(g, compiled)),
    unmatched: findings.unmatched.map((r) => redactRow(r, compiled)),
  };
}
