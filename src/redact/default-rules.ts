import type { RedactionRule, RedactionRules } from "../types.js";

export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  {
    name: "email",
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b",
    flags: "g",
    replacement: "[REDACTED:email]",
  },
  {
    name: "jwt",
    pattern: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b",
    flags: "g",
    replacement: "[REDACTED:jwt]",
  },
  {
    name: "authorization-header",
    pattern: "(?i)Authorization:\\s*(?:Bearer|Basic|ApiKey)\\s+\\S+",
    flags: "g",
    replacement: "Authorization: [REDACTED]",
  },
  {
    name: "guid-in-auth-context",
    pattern:
      "(?i)(token|secret|apikey|api_key|sessionid|session_id|cookie|auth)\\s*[=:]\\s*[\"']?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\"']?",
    flags: "g",
    replacement: "$1=[REDACTED:guid]",
  },
  {
    name: "ipv4-private-rfc1918-10",
    pattern: "\\b10\\.(?:[0-9]{1,3}\\.){2}[0-9]{1,3}\\b",
    flags: "g",
    replacement: "[REDACTED:ipv4]",
  },
  {
    name: "ipv4-private-rfc1918-192-168",
    pattern: "\\b192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}\\b",
    flags: "g",
    replacement: "[REDACTED:ipv4]",
  },
  {
    name: "ipv4-private-rfc1918-172",
    pattern: "\\b172\\.(?:1[6-9]|2[0-9]|3[01])\\.[0-9]{1,3}\\.[0-9]{1,3}\\b",
    flags: "g",
    replacement: "[REDACTED:ipv4]",
  },
  {
    name: "ipv4-public",
    pattern:
      "\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b",
    flags: "g",
    replacement: "[REDACTED:ipv4]",
  },
  {
    name: "ipv6",
    pattern: "\\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\\b",
    flags: "g",
    replacement: "[REDACTED:ipv6]",
  },
  {
    name: "internal-hostname-suffix",
    pattern: "\\b[a-z0-9-]+\\.(?:internal|corp|local)\\b",
    flags: "gi",
    replacement: "[REDACTED:hostname]",
  },
];

export const defaultRedactionRules: RedactionRules = {
  rules: DEFAULT_REDACTION_RULES,
};

function stripFlagsFromPattern(pattern: string): {
  pattern: string;
  inlineFlags: string;
} {
  const m = pattern.match(/^\(\?([imsxu]+)\)/);
  if (!m || !m[1]) return { pattern, inlineFlags: "" };
  return {
    pattern: pattern.slice(m[0].length),
    inlineFlags: m[1],
  };
}

export function compileRule(rule: RedactionRule): RegExp {
  const { pattern, inlineFlags } = stripFlagsFromPattern(rule.pattern);
  const requested = (rule.flags ?? "") + inlineFlags;
  const flagsSet = new Set(requested.split(""));
  flagsSet.add("g");
  return new RegExp(pattern, Array.from(flagsSet).join(""));
}
