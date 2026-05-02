import path from "node:path";
import type { MessageRole, TimelineItem, Transcript } from "./types.js";

interface ParseContext {
  sourcePath: string;
  metadata: Record<string, unknown>;
  items: TimelineItem[];
  order: number;
  lineCount: number;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
}

export function parseCodexJsonl(jsonl: string, sourcePath = "<stdin>"): Transcript {
  const ctx: ParseContext = {
    sourcePath,
    metadata: {},
    items: [],
    order: 0,
    lineCount: 0,
  };

  const lines = jsonl.split(/\r?\n/);
  for (const lineText of lines) {
    if (!lineText.trim()) continue;
    ctx.lineCount += 1;
    let record: unknown;
    try {
      record = JSON.parse(lineText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL at line ${ctx.lineCount}: ${message}`);
    }
    normalizeRecord(record, ctx.lineCount, ctx);
  }

  const stats = {
    lineCount: ctx.lineCount,
    itemCount: ctx.items.length,
    messageCount: ctx.items.filter((item) => item.kind === "message").length,
    toolCallCount: ctx.items.filter((item) => item.kind === "tool_call").length,
    toolResultCount: ctx.items.filter((item) => item.kind === "tool_result").length,
    reasoningCount: ctx.items.filter((item) => item.kind === "reasoning").length,
  };

  const fallbackTitle = path.basename(sourcePath).replace(/\.jsonl$/i, "") || "Codex session";
  const title = deriveTitle(ctx.items) ?? String(ctx.metadata.title ?? fallbackTitle);

  return {
    sourcePath,
    title,
    sessionId: ctx.sessionId,
    startedAt: ctx.startedAt,
    endedAt: ctx.endedAt,
    metadata: ctx.metadata,
    items: ctx.items,
    stats,
  };
}

function normalizeRecord(record: unknown, line: number, ctx: ParseContext): void {
  if (!isObject(record)) {
    pushItem(ctx, line, {
      kind: "event",
      title: `Line ${line}`,
      content: stringify(record),
      rawType: typeof record,
    });
    return;
  }

  const type = stringValue(record.type) ?? stringValue(record.kind) ?? stringValue(record.event);
  const timestamp = stringValue(record.timestamp) ?? stringValue(record.time) ?? stringValue(record.created_at);
  const payload = isObject(record.payload) ? record.payload : record;

  if (timestamp && !ctx.startedAt) ctx.startedAt = timestamp;
  if (timestamp) ctx.endedAt = timestamp;

  if (type === "session_meta" || type === "session_metadata") {
    const sessionId = stringValue(payload.id) ?? stringValue(payload.session_id) ?? stringValue(payload.sessionId);
    if (sessionId) ctx.sessionId = sessionId;
    ctx.metadata = { ...ctx.metadata, ...payload };
    pushItem(ctx, line, {
      kind: "metadata",
      title: "Session metadata",
      content: prettyJson(payload),
      rawType: type,
      timestamp,
      collapsed: true,
    });
    return;
  }

  if (type === "turn_context") {
    ctx.metadata = { ...ctx.metadata, ...payload };
    pushItem(ctx, line, {
      kind: "metadata",
      title: "Turn context",
      content: prettyJson(payload),
      rawType: type,
      timestamp,
      collapsed: true,
    });
    return;
  }

  if (type === "event_msg" || type === "event" || type === "log") {
    pushItem(ctx, line, {
      kind: "event",
      title: stringValue(payload.title) ?? stringValue(record.message) ?? "Event",
      content: stringValue(record.message) ?? stringValue(payload.message) ?? prettyJson(payload),
      rawType: type,
      timestamp,
      collapsed: true,
    });
    return;
  }

  if (type === "response_item") {
    normalizeResponseItem(payload, line, timestamp, ctx);
    return;
  }

  if (isMessageShape(record)) {
    normalizeMessage(record, line, timestamp, ctx, type ?? "message");
    return;
  }

  normalizeResponseItem(payload, line, timestamp, ctx, type ?? "record");
}

function normalizeResponseItem(
  payload: Record<string, unknown>,
  line: number,
  timestamp: string | undefined,
  ctx: ParseContext,
  fallbackType?: string,
): void {
  const itemType = stringValue(payload.type) ?? fallbackType ?? "response_item";

  if (itemType === "message" || isMessageShape(payload)) {
    normalizeMessage(payload, line, timestamp, ctx, itemType);
    return;
  }

  if (["function_call", "tool_call", "custom_tool_call", "local_shell_call"].includes(itemType)) {
    const name = stringValue(payload.name) ?? stringValue(payload.tool_name) ?? stringValue(payload.command) ?? "tool";
    const args = payload.arguments ?? payload.input ?? payload.command ?? payload;
    pushItem(ctx, line, {
      kind: "tool_call",
      title: `Tool call: ${name}`,
      content: typeof args === "string" ? args : prettyJson(args),
      rawType: itemType,
      timestamp,
      callId: stringValue(payload.call_id) ?? stringValue(payload.id),
      toolName: name,
      collapsed: true,
    });
    return;
  }

  if (["function_call_output", "tool_result", "custom_tool_call_output", "local_shell_call_output"].includes(itemType)) {
    const output = payload.output ?? payload.result ?? payload.content ?? payload;
    pushItem(ctx, line, {
      kind: "tool_result",
      title: `Tool result${payload.call_id ? `: ${String(payload.call_id)}` : ""}`,
      content: typeof output === "string" ? output : prettyJson(output),
      rawType: itemType,
      timestamp,
      callId: stringValue(payload.call_id) ?? stringValue(payload.id),
      collapsed: true,
    });
    return;
  }

  if (["reasoning", "summary", "thinking", "analysis"].includes(itemType)) {
    const summary = payload.summary ?? payload.content ?? payload.text ?? payload;
    pushItem(ctx, line, {
      kind: "reasoning",
      title: itemType === "summary" ? "Summary" : "Reasoning",
      content: contentToText(summary),
      rawType: itemType,
      timestamp,
      collapsed: true,
    });
    return;
  }

  if (payload.error || itemType === "error") {
    pushItem(ctx, line, {
      kind: "error",
      title: "Error",
      content: contentToText(payload.error ?? payload),
      rawType: itemType,
      timestamp,
      collapsed: false,
    });
    return;
  }

  pushItem(ctx, line, {
    kind: "event",
    title: itemType,
    content: prettyJson(payload),
    rawType: itemType,
    timestamp,
    collapsed: true,
  });
}

function normalizeMessage(
  payload: Record<string, unknown>,
  line: number,
  timestamp: string | undefined,
  ctx: ParseContext,
  rawType: string,
): void {
  const role = normalizeRole(stringValue(payload.role));
  const content = contentToText(payload.content ?? payload.message ?? payload.text ?? payload.output ?? "");
  pushItem(ctx, line, {
    kind: "message",
    role,
    title: role === "unknown" ? "Message" : role,
    content,
    rawType,
    timestamp,
    collapsed: false,
  });
}

function pushItem(ctx: ParseContext, line: number, item: Omit<TimelineItem, "id" | "line" | "order">): void {
  ctx.order += 1;
  ctx.items.push({
    id: `item-${ctx.order}`,
    line,
    order: ctx.order,
    ...item,
  });
}

function deriveTitle(items: TimelineItem[]): string | undefined {
  const firstUser = items.find((item) => item.kind === "message" && item.role === "user" && item.content.trim());
  if (!firstUser) return undefined;
  const firstLine = firstUser.content.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function contentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isObject(part)) return stringify(part);
        return (
          stringValue(part.text) ??
          stringValue(part.content) ??
          stringValue(part.output_text) ??
          stringValue(part.input_text) ??
          stringValue(part.summary_text) ??
          prettyJson(part)
        );
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (isObject(content)) {
    return (
      stringValue(content.text) ??
      stringValue(content.content) ??
      stringValue(content.message) ??
      stringValue(content.output) ??
      prettyJson(content)
    );
  }
  return stringify(content);
}

function normalizeRole(role: string | undefined): MessageRole {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "unknown";
}

function isMessageShape(value: Record<string, unknown>): boolean {
  return typeof value.role === "string" && ("content" in value || "message" in value || "text" in value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
