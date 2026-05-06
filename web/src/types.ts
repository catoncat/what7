export type AgentSlug = "cx" | "cl" | "gp";
export type Scope = "inbox" | "pinned" | "shared" | "drafts";

export interface Project {
  slug: string;
  name: string;
  color: string;
}

export interface AgentDef {
  slug: AgentSlug;
  name: string;
  glyph: string;
  fg: string;
  bg: string;
}

export interface Session {
  id: string;
  title: string;
  agent: AgentSlug;
  project: string;
  messageCount: number;
  toolCount: number;
  startedAt: string;
  pinned?: boolean;
  shared?: boolean;
  draft?: boolean;
  preview?: string;
}

export type MessageRole = "user" | "assistant" | "tool" | "reasoning";

export interface MessageBlock {
  id: string;
  role: MessageRole;
  content: string;
  meta?: string;
  collapsed?: boolean;
}

export interface SessionDetail extends Session {
  messages: MessageBlock[];
}
