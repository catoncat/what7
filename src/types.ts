export type TimelineKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "event"
  | "metadata"
  | "error";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export interface TimelineItem {
  id: string;
  line: number;
  order: number;
  timestamp?: string;
  kind: TimelineKind;
  role?: MessageRole;
  title: string;
  content: string;
  rawType?: string;
  callId?: string;
  toolName?: string;
  collapsed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TranscriptStats {
  lineCount: number;
  itemCount: number;
  messageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  reasoningCount: number;
  redactionCount?: number;
}

export interface Transcript {
  sourcePath: string;
  title: string;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  metadata: Record<string, unknown>;
  items: TimelineItem[];
  stats: TranscriptStats;
}

export interface RenderOptions {
  title?: string;
  redact?: boolean;
  sourcePath?: string;
  generatedAt?: string;
  maxInlineChars?: number;
}

export interface RenderResult {
  html: string;
  title: string;
  redactionCount: number;
  stats: TranscriptStats;
}

export interface PublishRecord {
  localId: string;
  remoteId: string;
  url: string;
  sourcePath: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "published" | "unpublished" | "failed";
  deleteCapability?: string;
  workerUrl?: string;
  htmlPath?: string;
  error?: string;
}

export interface SafePublishRecord extends Omit<PublishRecord, "deleteCapability"> {
  hasDeleteCapability: boolean;
}

export interface StateFile {
  version: 1;
  records: PublishRecord[];
  shortcuts: Shortcut[];
}

/**
 * A user-pinned shortcut surfaced in the dashboard sidebar.
 * `url` may be a relative dashboard path (e.g. `/api/v1/projects/:id/sessions`)
 * or any external URL.
 */
export interface Shortcut {
  id: string;
  label: string;
  url: string;
  icon?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}
