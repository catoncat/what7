import fs from "node:fs/promises";
import path from "node:path";
import type { ManagedMessage, ManagedSession, SearchHit, SessionIndexStore } from "./sessionIndex.js";

export interface HumanScope {
  cwd: string;
  project: string;
  allProjects: boolean;
  fallback: boolean;
}

export interface HumanSessionOptions {
  cwd?: string;
  project?: string;
  allProjects?: boolean;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}

export interface HumanSearchOptions extends HumanSessionOptions {
  query?: string;
}

export interface HumanTarget {
  inputPath: string;
  session?: ManagedSession;
  reason: "recent" | "id" | "path" | "search";
  scope: HumanScope;
}

export async function recentHumanSessions(
  store: SessionIndexStore,
  options: HumanSessionOptions = {},
): Promise<{ sessions: ManagedSession[]; scope: HumanScope }> {
  const scope = makeScope(options);
  const limit = options.limit ?? 12;
  const common = { since: options.since, until: options.until, limit, offset: options.offset };
  if (!scope.allProjects) {
    const sessions = await store.list({ ...common, project: scope.project });
    if (sessions.length) return { sessions, scope };
    scope.fallback = true;
  }
  return { sessions: await store.list(common), scope };
}

export async function findHumanSessions(
  store: SessionIndexStore,
  query: string,
  options: HumanSearchOptions = {},
): Promise<{ hits: SearchHit[]; scope: HumanScope }> {
  const scope = makeScope(options);
  const limit = options.limit ?? 20;
  const common = { limit, offset: options.offset, since: options.since, until: options.until };
  if (!scope.allProjects) {
    const hits = await store.search(query, { ...common, project: scope.project });
    if (hits.length) return { hits, scope };
    scope.fallback = true;
  }
  return { hits: await store.search(query, common), scope };
}

export async function resolveHumanSessionTarget(
  store: SessionIndexStore,
  rawTarget: string | undefined,
  options: HumanSessionOptions = {},
): Promise<HumanTarget> {
  const scope = makeScope(options);
  const target = rawTarget?.trim();

  if (!target) {
    const recent = await recentHumanSessions(store, { ...options, limit: 1 });
    const session = recent.sessions[0];
    if (!session) throw new Error("No indexed sessions found. Run `what7 sync` first, or pass a JSONL path.");
    return { inputPath: session.sourcePath, session, reason: "recent", scope: recent.scope };
  }

  const directPath = await existingJsonlPath(target);
  if (directPath) return { inputPath: directPath, reason: "path", scope };

  const session = await store.find(target);
  if (session) return { inputPath: session.sourcePath, session, reason: "id", scope };

  const found = await findHumanSessions(store, target, { ...options, limit: 1 });
  const hit = found.hits[0];
  if (hit) return { inputPath: hit.session.sourcePath, session: hit.session, reason: "search", scope: found.scope };

  throw new Error(`No session found for ${target}. Try \`what7 recent\`, \`what7 find "${target}"\`, or pass a JSONL path.`);
}

export function makeScope(options: HumanSessionOptions = {}): HumanScope {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const project = options.project?.trim() || path.basename(cwd) || cwd;
  return { cwd, project, allProjects: Boolean(options.allProjects), fallback: false };
}

export function formatSessionRows(sessions: ManagedSession[], scope: HumanScope): string {
  if (!sessions.length) return "No indexed sessions. Run `what7 sync` first.";
  const header = scope.allProjects
    ? "Recent sessions:"
    : scope.fallback
      ? `No sessions for ${scope.project}; showing recent sessions from all projects:`
      : `Recent sessions for ${scope.project}:`;
  return [
    header,
    ...sessions.map((session, index) => {
      const marker = session.project === scope.project ? "★" : " ";
      return `${String(index + 1).padStart(2, " ")} ${marker} ${session.id}  ${formatDate(session.startedAt ?? session.updatedAt)}  ${session.project}  ${session.title}`;
    }),
    "",
    "Next: what7 view <id>  ·  what7 share <id>",
  ].join("\n");
}

export function formatSearchRows(hits: SearchHit[], scope: HumanScope): string {
  if (!hits.length) return "No matches.";
  const header = scope.allProjects
    ? "Search hits:"
    : scope.fallback
      ? `No hits for ${scope.project}; showing hits from all projects:`
      : `Search hits for ${scope.project}:`;
  return [
    header,
    ...hits.map((hit, index) => {
      const marker = hit.session.project === scope.project ? "★" : " ";
      return `${String(index + 1).padStart(2, " ")} ${marker} ${hit.session.id}  line ${hit.message.line}  ${hit.session.project}  ${hit.snippet.replace(/\s+/g, " ")}`;
    }),
    "",
    "Next: what7 view <id>  ·  what7 share <id>",
  ].join("\n");
}

export function formatSessionPreview(session: ManagedSession, messages: ManagedMessage[], options: { includeTools?: boolean; includeContext?: boolean } = {}): string {
  const lines = [
    session.title,
    `${session.id} · ${session.project} · ${session.sourcePath}`,
    "",
  ];
  const visible = messages.filter((message) => {
    if (message.kind === "tool_call" || message.kind === "tool_result") return Boolean(options.includeTools);
    if (message.kind === "reasoning") return Boolean(options.includeContext);
    return message.kind === "message";
  });
  for (const message of visible.slice(0, 24)) {
    const role = message.role ?? message.kind;
    lines.push(`[${role}] ${message.content.trim().replace(/\s+/g, " ").slice(0, 500)}`);
  }
  if (visible.length > 24) lines.push(`… ${visible.length - 24} more visible items`);
  lines.push("", "Next: what7 share " + session.id);
  return lines.join("\n");
}

async function existingJsonlPath(input: string): Promise<string | undefined> {
  if (!input.endsWith(".jsonl") && !input.includes(path.sep)) return undefined;
  const resolved = path.resolve(input);
  try {
    const stat = await fs.stat(resolved);
    return stat.isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function formatDate(value?: string): string {
  if (!value) return "unknown-time";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 16);
}
