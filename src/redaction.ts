export interface RedactionResult {
  text: string;
  count: number;
}

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const DEFAULT_RULES: RedactionRule[] = [
  {
    name: "authorization bearer",
    pattern: /\b(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+\-/=]{12,})/gi,
    replacement: "$1[REDACTED]",
  },
  {
    name: "env secret assignment",
    pattern:
      /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|AUTH)[A-Z0-9_]*\s*=\s*)(["']?)([^\s"'`]{8,})(\2)/gi,
    replacement: "$1$2[REDACTED]$4",
  },
  {
    name: "json secret property",
    pattern:
      /("(?:api[_-]?key|token|secret|password|private[_-]?key|authorization)"\s*:\s*")([^"\\]{8,})(")/gi,
    replacement: "$1[REDACTED]$3",
  },
  {
    name: "openai style key",
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  {
    name: "github token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    name: "slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    replacement: "[REDACTED_SLACK_TOKEN]",
  },
  {
    name: "cloudflare token-ish",
    pattern: /\b(cf-[A-Za-z0-9_-]{20,}|CLOUDFLARE_[A-Z0-9_]*\s*=\s*[^\s"'`]{8,})\b/g,
    replacement: "[REDACTED_CLOUDFLARE_TOKEN]",
  },
];

export function redactText(input: string, extraRules: RedactionRule[] = []): RedactionResult {
  let text = input;
  let count = 0;
  for (const rule of [...DEFAULT_RULES, ...extraRules]) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      const match = String(args[0]);
      const replaced = match.replace(rule.pattern, rule.replacement);
      if (replaced !== match || rule.replacement !== match) count += 1;
      // String.replace callback cannot safely reuse the same global regex here.
      return applyReplacement(rule.replacement, args);
    });
  }
  return { text, count };
}

function applyReplacement(replacement: string, args: unknown[]): string {
  let output = replacement;
  for (let i = 1; i <= 9; i += 1) {
    const group = args[i];
    output = output.replaceAll(`$${i}`, typeof group === "string" ? group : "");
  }
  return output;
}

export function redactObjectStrings<T>(value: T): { value: T; count: number } {
  let count = 0;
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      const result = redactText(node);
      count += result.count;
      return result.text;
    }
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) out[key] = visit(child);
      return out;
    }
    return node;
  };
  return { value: visit(value) as T, count };
}
