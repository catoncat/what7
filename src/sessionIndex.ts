import fs from "node:fs/promises";
import fsSync from "node:fs";
import readline from "node:readline";
import path from "node:path";
import os from "node:os";
import { parseCodexJsonl } from "./parser.js";
import { StateStore } from "./state.js";
import type { MessageRole, TimelineItem, Transcript } from "./types.js";

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface ManagedSession {
  id: string;
  agent: "codex";
  title: string;
  project: string;
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  model?: string;
  lineCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  reasoningCount: number;
  firstMessage: string;
  tokenUsage: TokenUsageSummary;
  toolUsage: Record<string, number>;
}

export interface ManagedMessage {
  id: string;
  sessionId: string;
  order: number;
  line: number;
  kind: TimelineItem["kind"];
  role?: MessageRole;
  timestamp?: string;
  title: string;
  content: string;
  toolName?: string;
  callId?: string;
}

export interface SessionIndexFile {
  version: 1;
  lastSyncAt?: string;
  roots: string[];
  sessions: ManagedSession[];
  messages: ManagedMessage[];
}

export interface SyncOptions {
  stateDir?: string;
  dirs?: string[];
  maxFiles?: number;
}

export interface SyncResult {
  roots: string[];
  scannedFiles: number;
  indexedSessions: number;
  skippedFiles: Array<{ path: string; error: string }>;
  index: SessionIndexFile;
}

export interface ListSessionFilters {
  query?: string;
  project?: string;
  agent?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  session: ManagedSession;
  message: ManagedMessage;
  snippet: string;
}

export interface AnalyticsSummary {
  sessionCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  totalDurationMs: number;
  tokenUsage: TokenUsageSummary;
  projects: Array<{ project: string; sessionCount: number; messageCount: number }>;
  agents: Array<{ agent: string; sessionCount: number }>;
  tools: Array<{ tool: string; count: number }>;
  daily: Array<{ date: string; sessions: number; messages: number; outputTokens: number }>;
}

const INDEX_VERSION = 1 as const;
const INDEX_CONTENT_LIMIT = 1_000;
const TOOL_OUTPUT_INDEX_LIMIT = 400;
const MAX_INDEX_ITEMS_PER_SESSION = 2_000;

export class SessionIndexStore {
  readonly dir: string;
  readonly file: string;
  readonly messagesFile: string;

  constructor(stateDir?: string) {
    const state = new StateStore(stateDir);
    this.dir = state.dir;
    this.file = path.join(this.dir, "sessions.json");
    this.messagesFile = path.join(this.dir, "messages.jsonl");
  }

  async load(): Promise<SessionIndexFile> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionIndexFile>;
      if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.messages)) {
        throw new Error(`Unsupported session index version: ${String(parsed.version)}`);
      }
      return {
        version: INDEX_VERSION,
        lastSyncAt: parsed.lastSyncAt,
        roots: parsed.roots ?? [],
        sessions: parsed.sessions,
        messages: parsed.messages,
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return emptyIndex();
      throw error;
    }
  }

  async save(index: SessionIndexFile): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  async list(filters: ListSessionFilters = {}): Promise<ManagedSession[]> {
    const index = await this.load();
    return filterSessions(index.sessions, filters).sort(compareSessionsDesc);
  }

  async find(idOrPath: string): Promise<ManagedSession | undefined> {
    const index = await this.load();
    const resolved = path.resolve(idOrPath);
    return index.sessions.find((session) => session.id === idOrPath || session.sourcePath === idOrPath || session.sourcePath === resolved);
  }

  async messages(sessionId: string): Promise<ManagedMessage[]> {
    const out: ManagedMessage[] = [];
    for await (const message of this.iterMessages()) {
      if (message.sessionId === sessionId) out.push(message);
    }
    return out.sort((a, b) => a.order - b.order);
  }

  async search(query: string, filters: ListSessionFilters = {}): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const index = await this.load();
    const sessionFilters = { ...filters, limit: undefined, offset: undefined };
    const sessions = new Map(filterSessions(index.sessions, sessionFilters).map((session) => [session.id, session]));
    const hits: SearchHit[] = [];
    const limit = filters.limit ?? 200;
    const offset = Math.max(0, filters.offset ?? 0);
    let skipped = 0;
    for await (const message of this.iterMessages()) {
      if (hits.length >= limit) break;
      const session = sessions.get(message.sessionId);
      if (!session) continue;
      const haystack = `${message.title}\n${message.content}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      hits.push({ session, message, snippet: makeSnippet(message.content, query) });
    }
    return hits;
  }

  async *iterMessages(): AsyncGenerator<ManagedMessage> {
    try {
      const rl = readline.createInterface({ input: fsSync.createReadStream(this.messagesFile, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as ManagedMessage;
        } catch {
          // Ignore corrupt message-index rows; a future sync rewrites this file.
        }
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }

  async analytics(filters: ListSessionFilters = {}): Promise<AnalyticsSummary> {
    const index = await this.load();
    const sessions = filterSessions(index.sessions, filters);
    return buildAnalytics(sessions);
  }
}

export async function syncSessions(options: SyncOptions = {}): Promise<SyncResult> {
  const store = new SessionIndexStore(options.stateDir);
  const roots = normalizeRoots(options.dirs?.length ? options.dirs : defaultSessionRoots());
  const files = await discoverSessionFiles(roots, options.maxFiles);
  const sessions: ManagedSession[] = [];
  const skippedFiles: Array<{ path: string; error: string }> = [];
  await fs.mkdir(store.dir, { recursive: true, mode: 0o700 });
  const messageWriter = fsSync.createWriteStream(store.messagesFile, { encoding: "utf8", mode: 0o600 });
  messageWriter.setMaxListeners(0);

  try {
    for (const file of files) {
      try {
        const indexed = await indexCodexSessionFile(file);
        sessions.push(indexed.session);
        for (const message of indexed.messages) await writeJsonLine(messageWriter, message);
      } catch (error) {
        skippedFiles.push({ path: file, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await closeWriter(messageWriter);
  }

  const index: SessionIndexFile = {
    version: INDEX_VERSION,
    lastSyncAt: new Date().toISOString(),
    roots,
    sessions: sessions.sort(compareSessionsDesc),
    messages: [],
  };
  await store.save(index);
  return { roots, scannedFiles: files.length, indexedSessions: sessions.length, skippedFiles, index };
}


export async function indexCodexSessionFile(file: string): Promise<{ session: ManagedSession; messages: ManagedMessage[] }> {
  const stat = await fs.stat(file);
  const sourcePath = path.resolve(file);
  const messages: ManagedMessage[] = [];
  const metadata: Record<string, unknown> = {};
  const toolUsage: Record<string, number> = {};
  const tokenUsage = zeroUsage();
  const seenUsage = new Set<string>();
  let lineCount = 0;
  let order = 0;
  let sessionRawId = path.basename(file, ".jsonl");
  let cwd = "";
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let firstMessage = "";
  let title = path.basename(file, ".jsonl");
  let messageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  let reasoningCount = 0;
  const pending: Array<Omit<ManagedMessage, "sessionId">> = [];

  const rl = readline.createInterface({
    input: fsSync.createReadStream(sourcePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount += 1;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(record)) continue;
    const timestamp = stringMeta(record.timestamp) ?? stringMeta(record.time) ?? stringMeta(record.created_at);
    if (timestamp && !startedAt) startedAt = timestamp;
    if (timestamp) endedAt = timestamp;
    const type = stringMeta(record.type) ?? stringMeta(record.kind) ?? stringMeta(record.event);
    const payload = isObject(record.payload) ? record.payload : record;

    if (type === "session_meta" || type === "session_metadata") {
      Object.assign(metadata, payload);
      sessionRawId = stringMeta(payload.id) ?? stringMeta(payload.session_id) ?? stringMeta(payload.sessionId) ?? sessionRawId;
      cwd = stringMeta(payload.cwd) ?? cwd;
      model = stringMeta(payload.model) ?? model;
      continue;
    }

    if (type === "turn_context") {
      Object.assign(metadata, payload);
      model = stringMeta(payload.model) ?? model;
      continue;
    }

    if (type === "event_msg" && payload.type === "token_count" && isObject(payload.info)) {
      applyStreamingTokenUsage(payload.info, tokenUsage, seenUsage);
      continue;
    }

    if (type !== "response_item" && !isResponseLike(payload)) continue;
    const itemType = stringMeta(payload.type) ?? type ?? "response_item";
    order += 1;

    if (itemType === "message" || isMessageShape(payload)) {
      const role = normalizeRole(stringMeta(payload.role));
      const content = capIndexContent(contentToText(payload.content ?? payload.message ?? payload.text ?? payload.output ?? ""), INDEX_CONTENT_LIMIT);
      if (!content.trim()) continue;
      messageCount += 1;
      if (role === "user") {
        userMessageCount += 1;
        if (!firstMessage) {
          firstMessage = content.trim().replace(/\s+/g, " ").slice(0, 300);
          title = firstMessage.length > 80 ? `${firstMessage.slice(0, 77)}...` : firstMessage;
        }
      } else if (role === "assistant") {
        assistantMessageCount += 1;
      }
      pushPending(pending, {
        id: `pending:${order}`,
        order,
        line: lineCount,
        kind: "message",
        role,
        timestamp,
        title: role === "unknown" ? "Message" : role,
        content,
      });
      continue;
    }

    if (["function_call", "tool_call", "custom_tool_call", "local_shell_call"].includes(itemType)) {
      const toolName = stringMeta(payload.name) ?? stringMeta(payload.tool_name) ?? stringMeta(payload.command) ?? "tool";
      const args = payload.arguments ?? payload.input ?? payload.command ?? payload;
      const content = capIndexContent(typeof args === "string" ? args : JSON.stringify(args), INDEX_CONTENT_LIMIT);
      toolCallCount += 1;
      toolUsage[toolName] = (toolUsage[toolName] ?? 0) + 1;
      pushPending(pending, {
        id: `pending:${order}`,
        order,
        line: lineCount,
        kind: "tool_call",
        timestamp,
        title: `Tool call: ${toolName}`,
        content,
        toolName,
        callId: stringMeta(payload.call_id) ?? stringMeta(payload.id),
      });
      continue;
    }

    if (["function_call_output", "tool_result", "custom_tool_call_output", "local_shell_call_output"].includes(itemType)) {
      const output = payload.output ?? payload.result ?? payload.content ?? payload;
      toolResultCount += 1;
      pushPending(pending, {
        id: `pending:${order}`,
        order,
        line: lineCount,
        kind: "tool_result",
        timestamp,
        title: "Tool result",
        content: capIndexContent(typeof output === "string" ? output : JSON.stringify(output), TOOL_OUTPUT_INDEX_LIMIT),
        callId: stringMeta(payload.call_id) ?? stringMeta(payload.id),
      });
      continue;
    }

    if (["reasoning", "summary", "thinking", "analysis"].includes(itemType)) {
      reasoningCount += 1;
      pushPending(pending, {
        id: `pending:${order}`,
        order,
        line: lineCount,
        kind: "reasoning",
        timestamp,
        title: itemType === "summary" ? "Summary" : "Reasoning",
        content: capIndexContent(contentToText(payload.summary ?? payload.content ?? payload.text ?? payload), INDEX_CONTENT_LIMIT),
      });
    }
  }

  tokenUsage.totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens + tokenUsage.cachedInputTokens;
  tokenUsage.estimatedCostUsd = estimateCost(model, tokenUsage);
  const sessionId = `codex:${sessionRawId}`;
  const project = cwd ? path.basename(cwd) || cwd : path.basename(path.dirname(sourcePath));
  const session: ManagedSession = {
    id: sessionId,
    agent: "codex",
    title,
    project,
    sourcePath,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    startedAt,
    endedAt,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    model,
    lineCount,
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    toolResultCount,
    reasoningCount,
    firstMessage,
    tokenUsage,
    toolUsage,
  };
  return {
    session,
    messages: pending.map((message) => ({ ...message, id: `${sessionId}:${message.order}`, sessionId })),
  };
}


async function writeJsonLine(writer: fsSync.WriteStream, value: unknown): Promise<void> {
  if (writer.write(`${JSON.stringify(value)}\n`)) return;
  await new Promise<void>((resolve, reject) => {
    writer.once("drain", resolve);
    writer.once("error", reject);
  });
}

async function closeWriter(writer: fsSync.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writer.end(() => resolve());
    writer.once("error", reject);
  });
}

function pushPending(pending: Array<Omit<ManagedMessage, "sessionId">>, message: Omit<ManagedMessage, "sessionId">): void {
  if (pending.length < MAX_INDEX_ITEMS_PER_SESSION) pending.push(message);
}

export function defaultSessionRoots(): string[] {
  if (process.env.CODEX_SESSIONS_DIR) return splitPathList(process.env.CODEX_SESSIONS_DIR);
  return [path.join(os.homedir(), ".codex", "sessions")];
}

export async function discoverSessionFiles(roots: string[], maxFiles = 20_000): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) await walk(root, out, maxFiles);
  return out.sort();
}

export function sessionFromTranscript(transcript: Transcript, rawJsonl: string, stat: { size: number; mtimeMs: number }): ManagedSession {
  const id = transcript.sessionId ? `codex:${transcript.sessionId}` : `codex:${path.basename(transcript.sourcePath, ".jsonl")}`;
  const messages = transcript.items.filter((item) => item.kind === "message");
  const userMessages = messages.filter((item) => item.role === "user");
  const assistantMessages = messages.filter((item) => item.role === "assistant");
  const toolUsage: Record<string, number> = {};
  for (const item of transcript.items) {
    if (item.kind === "tool_call") {
      const toolName = item.toolName ?? (item.title.replace(/^Tool call:\s*/i, "") || "tool");
      toolUsage[toolName] = (toolUsage[toolName] ?? 0) + 1;
    }
  }
  const cwd = stringMeta(transcript.metadata.cwd);
  const project = cwd ? path.basename(cwd) || cwd : path.basename(path.dirname(transcript.sourcePath));
  const model = stringMeta(transcript.metadata.model) ?? extractLastModel(rawJsonl);
  const tokenUsage = extractTokenUsage(rawJsonl, model);
  const firstMessage = userMessages[0]?.content.trim().replace(/\s+/g, " ").slice(0, 300) ?? "";
  return {
    id,
    agent: "codex",
    title: transcript.title,
    project,
    sourcePath: transcript.sourcePath,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    startedAt: transcript.startedAt,
    endedAt: transcript.endedAt,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    model,
    lineCount: transcript.stats.lineCount,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    toolCallCount: transcript.stats.toolCallCount,
    toolResultCount: transcript.stats.toolResultCount,
    reasoningCount: transcript.stats.reasoningCount,
    firstMessage,
    tokenUsage,
    toolUsage,
  };
}

export function messagesFromTranscript(transcript: Transcript, sessionId: string): ManagedMessage[] {
  return transcript.items.map((item) => ({
    id: `${sessionId}:${item.order}`,
    sessionId,
    order: item.order,
    line: item.line,
    kind: item.kind,
    role: item.role,
    timestamp: item.timestamp,
    title: item.title,
    content: item.content,
    toolName: item.toolName,
    callId: item.callId,
  }));
}

export function filterSessions(sessions: ManagedSession[], filters: ListSessionFilters): ManagedSession[] {
  const q = filters.query?.trim().toLowerCase();
  const sinceMs = filters.since ? Date.parse(filters.since) : Number.NaN;
  const untilMs = filters.until ? Date.parse(filters.until) : Number.NaN;
  let out = sessions.filter((session) => {
    if (filters.agent && session.agent !== filters.agent) return false;
    if (filters.project && session.project !== filters.project) return false;
    const ts = Date.parse(session.startedAt ?? session.updatedAt);
    if (Number.isFinite(sinceMs) && ts < sinceMs) return false;
    if (Number.isFinite(untilMs) && ts > untilMs) return false;
    if (q) {
      const haystack = `${session.title}\n${session.project}\n${session.sourcePath}\n${session.firstMessage}\n${session.model ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  out = out.sort(compareSessionsDesc);
  const offset = Math.max(0, filters.offset ?? 0);
  if (offset > 0 || (filters.limit && filters.limit > 0)) {
    const end = filters.limit && filters.limit > 0 ? offset + filters.limit : undefined;
    out = out.slice(offset, end);
  }
  return out;
}

export function buildAnalytics(sessions: ManagedSession[]): AnalyticsSummary {
  const projects = new Map<string, { project: string; sessionCount: number; messageCount: number }>();
  const agents = new Map<string, { agent: string; sessionCount: number }>();
  const tools = new Map<string, { tool: string; count: number }>();
  const daily = new Map<string, { date: string; sessions: number; messages: number; outputTokens: number }>();
  const tokenUsage = zeroUsage();
  let messageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  let totalDurationMs = 0;

  for (const session of sessions) {
    messageCount += session.messageCount;
    userMessageCount += session.userMessageCount;
    assistantMessageCount += session.assistantMessageCount;
    toolCallCount += session.toolCallCount;
    toolResultCount += session.toolResultCount;
    totalDurationMs += durationMs(session.startedAt, session.endedAt);
    addUsage(tokenUsage, session.tokenUsage);

    const project = projects.get(session.project) ?? { project: session.project, sessionCount: 0, messageCount: 0 };
    project.sessionCount += 1;
    project.messageCount += session.messageCount;
    projects.set(project.project, project);

    const agent = agents.get(session.agent) ?? { agent: session.agent, sessionCount: 0 };
    agent.sessionCount += 1;
    agents.set(agent.agent, agent);

    for (const [tool, count] of Object.entries(session.toolUsage)) {
      const row = tools.get(tool) ?? { tool, count: 0 };
      row.count += count;
      tools.set(tool, row);
    }

    const day = (session.startedAt ?? session.updatedAt).slice(0, 10);
    const row = daily.get(day) ?? { date: day, sessions: 0, messages: 0, outputTokens: 0 };
    row.sessions += 1;
    row.messages += session.messageCount;
    row.outputTokens += session.tokenUsage.outputTokens;
    daily.set(day, row);
  }

  tokenUsage.totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens + tokenUsage.cachedInputTokens;
  tokenUsage.estimatedCostUsd = null;

  return {
    sessionCount: sessions.length,
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    toolResultCount,
    totalDurationMs,
    tokenUsage,
    projects: [...projects.values()].sort((a, b) => b.sessionCount - a.sessionCount),
    agents: [...agents.values()].sort((a, b) => b.sessionCount - a.sessionCount),
    tools: [...tools.values()].sort((a, b) => b.count - a.count),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}


function applyStreamingTokenUsage(info: Record<string, unknown>, usage: TokenUsageSummary, seen: Set<string>): void {
  const rawValue = info.last_token_usage;
  if (!isObject(rawValue)) return;
  const raw = JSON.stringify(rawValue);
  if (seen.has(raw)) return;
  seen.add(raw);
  usage.inputTokens += numberValue(rawValue.input_tokens);
  usage.outputTokens += numberValue(rawValue.output_tokens);
  usage.cachedInputTokens += numberValue(rawValue.cached_input_tokens);
  if (isObject(rawValue.output_tokens_details)) usage.reasoningOutputTokens += numberValue(rawValue.output_tokens_details.reasoning_tokens);
}

function isResponseLike(value: Record<string, unknown>): boolean {
  return typeof value.type === "string" || isMessageShape(value);
}

function isMessageShape(value: Record<string, unknown>): boolean {
  return typeof value.role === "string" && ("content" in value || "message" in value || "text" in value);
}

function normalizeRole(role: string | undefined): MessageRole {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "unknown";
}

function contentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!isObject(part)) return JSON.stringify(part);
      return stringMeta(part.text) ?? stringMeta(part.content) ?? stringMeta(part.output_text) ?? stringMeta(part.input_text) ?? stringMeta(part.summary_text) ?? JSON.stringify(part);
    }).filter(Boolean).join("\n\n");
  }
  if (isObject(content)) return stringMeta(content.text) ?? stringMeta(content.content) ?? stringMeta(content.message) ?? stringMeta(content.output) ?? JSON.stringify(content);
  return JSON.stringify(content);
}

function capIndexContent(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [what7 index preview truncated; open the session to view full source]`;
}

function extractTokenUsage(rawJsonl: string, model?: string): TokenUsageSummary {
  const usage = zeroUsage();
  const seen = new Set<string>();
  for (const line of rawJsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { continue; }
    if (!isObject(record) || record.type !== "event_msg" || !isObject(record.payload)) continue;
    const payload = record.payload;
    if (payload.type !== "token_count" || !isObject(payload.info)) continue;
    const raw = isObject(payload.info.last_token_usage) ? JSON.stringify(payload.info.last_token_usage) : undefined;
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const item = payload.info.last_token_usage as Record<string, unknown>;
    usage.inputTokens += numberValue(item.input_tokens);
    usage.outputTokens += numberValue(item.output_tokens);
    usage.cachedInputTokens += numberValue(item.cached_input_tokens);
    if (isObject(item.output_tokens_details)) usage.reasoningOutputTokens += numberValue(item.output_tokens_details.reasoning_tokens);
  }
  usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cachedInputTokens;
  usage.estimatedCostUsd = estimateCost(model, usage);
  return usage;
}

function estimateCost(model: string | undefined, usage: TokenUsageSummary): number | null {
  // Offline fallback only. Pricing changes often; this is deliberately
  // conservative and null for unknown models rather than pretending accuracy.
  const key = model?.toLowerCase() ?? "";
  const rates = key.includes("gpt-5")
    ? { input: 1.25, cached: 0.125, output: 10 }
    : key.includes("gpt-4.1")
      ? { input: 2, cached: 0.5, output: 8 }
      : key.includes("gpt-4o")
        ? { input: 2.5, cached: 1.25, output: 10 }
        : null;
  if (!rates) return null;
  return round6((usage.inputTokens * rates.input + usage.cachedInputTokens * rates.cached + usage.outputTokens * rates.output) / 1_000_000);
}

function extractLastModel(rawJsonl: string): string | undefined {
  let model: string | undefined;
  for (const line of rawJsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.type === "turn_context" && isObject(record.payload) && typeof record.payload.model === "string") model = record.payload.model;
      if (record.type === "session_meta" && isObject(record.payload) && typeof record.payload.model === "string") model = record.payload.model;
    } catch {}
  }
  return model;
}

function zeroUsage(): TokenUsageSummary {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, estimatedCostUsd: null };
}

function addUsage(target: TokenUsageSummary, value: TokenUsageSummary): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
  target.totalTokens += value.totalTokens;
}

function durationMs(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : 0;
}

function compareSessionsDesc(a: ManagedSession, b: ManagedSession): number {
  return (Date.parse(b.startedAt ?? b.updatedAt) || b.sourceMtimeMs) - (Date.parse(a.startedAt ?? a.updatedAt) || a.sourceMtimeMs);
}

async function walk(root: string, out: string[], maxFiles: number): Promise<void> {
  if (out.length >= maxFiles) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, out, maxFiles);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
}

function normalizeRoots(roots: string[]): string[] {
  return roots.map((root) => path.resolve(expandHome(root)));
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function splitPathList(value: string): string[] {
  return value.split(path.delimiter).map((part) => part.trim()).filter(Boolean);
}

function makeSnippet(content: string, query: string): string {
  const q = query.toLowerCase();
  const lower = content.toLowerCase();
  const at = lower.indexOf(q);
  if (at === -1) return content.slice(0, 240);
  const start = Math.max(0, at - 80);
  const end = Math.min(content.length, at + query.length + 140);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringMeta(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyIndex(): SessionIndexFile {
  return { version: INDEX_VERSION, roots: [], sessions: [], messages: [] };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
