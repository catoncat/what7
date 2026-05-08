// what7 frontend DTOs — mirror the server's /api/v1 surface
// (see src/sessionIndex.ts ManagedSession / ManagedMessage / ProjectInfo).

export type AgentSlug = "codex";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type MessageKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "event"
  | "metadata"
  | "error";

export interface Project {
  slug: string;        // URL-safe derived from cwd (basename + parent-basename upgrade)
  name: string;        // basename(cwd) — raw, used when displayName is unset
  cwd: string;
  sessionCount: number;
  messageCount: number;
  lastSessionAt: string | null;
  displayName?: string; // user-set alias (M4.3)
  hidden?: boolean;     // user-set sidebar filter (M4.3)
}

export interface Session {
  id: string;
  agent: AgentSlug;
  title: string;
  project: string;     // basename(cwd)
  sourcePath: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  model?: string;
  lineCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  firstMessage: string;
}

export interface MessageBlock {
  id: string;
  sessionId: string;
  order: number;
  line: number;
  kind: MessageKind;
  role?: MessageRole;
  timestamp?: string;
  title: string;
  content: string;
  toolName?: string;
  callId?: string;
}

export interface SessionDetail {
  session: Session;
  messages: MessageBlock[];
}

export interface Shortcut {
  id: string;
  label: string;
  url: string;
  icon?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageInfo {
  limit: number;
  offset: number;
  has_more: boolean;
}
