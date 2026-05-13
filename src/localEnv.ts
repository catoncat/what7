import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const LOCAL_ENV_KEYS = new Set(["WHAT7_WORKER_URL", "WHAT7_ADMIN_TOKEN"]);

export interface LoadLocalDeployEnvOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadLocalDeployEnvResult {
  file: string;
  found: boolean;
  loaded: string[];
  skippedExisting: string[];
  ignored: string[];
}

export async function loadLocalDeployEnv(options: LoadLocalDeployEnvOptions = {}): Promise<LoadLocalDeployEnvResult> {
  const rootDir = options.rootDir ?? repoRoot();
  const file = path.join(rootDir, ".what7", "deploy.env");
  const env = options.env ?? process.env;

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return { file, found: false, loaded: [], skippedExisting: [], ignored: [] };
    throw error;
  }

  const loaded: string[] = [];
  const skippedExisting: string[] = [];
  const ignored: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (!LOCAL_ENV_KEYS.has(parsed.key)) {
      ignored.push(parsed.key);
      continue;
    }
    if (env[parsed.key] !== undefined) {
      skippedExisting.push(parsed.key);
      continue;
    }
    env[parsed.key] = parsed.value;
    loaded.push(parsed.key);
  }

  return { file, found: true, loaded, skippedExisting, ignored };
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const equals = assignment.indexOf("=");
  if (equals <= 0) return null;

  const key = assignment.slice(0, equals).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  return { key, value: parseEnvValue(assignment.slice(equals + 1).trim()) };
}

function parseEnvValue(value: string): string {
  if (!value) return "";
  const quote = value[0];
  if (quote === "'" || quote === "\"") {
    const end = findClosingQuote(value, quote);
    if (end > 0) return value.slice(1, end);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

function findClosingQuote(value: string, quote: string): number {
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] === quote && value[i - 1] !== "\\") return i;
  }
  return -1;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
