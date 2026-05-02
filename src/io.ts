import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parseCodexJsonl } from "./parser.js";
import { renderTranscript } from "./renderer.js";
import type { RenderOptions, RenderResult, Transcript } from "./types.js";

export async function readTranscriptFile(inputPath: string): Promise<Transcript> {
  const sourcePath = path.resolve(inputPath);
  const jsonl = await fs.readFile(sourcePath, "utf8");
  return parseCodexJsonl(jsonl, sourcePath);
}

export async function renderFile(inputPath: string, options: RenderOptions & { outputPath?: string } = {}): Promise<RenderResult & { outputPath: string; sourceHash: string }> {
  const sourcePath = path.resolve(inputPath);
  const transcript = await readTranscriptFile(sourcePath);
  const result = renderTranscript(transcript, { ...options, sourcePath });
  const outputPath = path.resolve(options.outputPath ?? defaultOutputPath(sourcePath));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, result.html, "utf8");
  return { ...result, outputPath, sourceHash: sha256(await fs.readFile(sourcePath)) };
}

export function defaultOutputPath(inputPath: string): string {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.html`);
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
