import type {
  MessageBlock,
  PageInfo,
  Project,
  Session,
  Shortcut,
} from "@/types";

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(await formatHttpError(res, path));
  return (await res.json()) as T;
}

async function jsend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await formatHttpError(res, path));
  return (await res.json()) as T;
}

async function formatHttpError(res: Response, path: string): Promise<string> {
  const detail = await readErrorDetail(res);
  return `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""} — ${path}`;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await res.json()) as unknown;
      if (body && typeof body === "object") {
        const { error, message } = body as { error?: unknown; message?: unknown };
        if (typeof error === "string" && error.trim()) return error.trim();
        if (typeof message === "string" && message.trim()) return message.trim();
      }
      return "";
    }
    const text = (await res.text()).trim();
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return "";
  }
}

export interface SessionPage {
  sessions: Session[];
  page: PageInfo;
}

export interface SessionDetailResponse {
  session: Session;
  messages?: MessageBlock[];
}

export interface ShareMessageInput {
  id: string;
  order: number;
  content?: string;
}

export function fetchProjects(): Promise<Project[]> {
  return jget<{ projects: Project[] }>("/api/v1/projects").then((r) => r.projects);
}

export function fetchProject(slug: string): Promise<Project> {
  return jget<{ project: Project }>(
    `/api/v1/projects/${encodeURIComponent(slug)}`,
  ).then((r) => r.project);
}

export function fetchSessions(params: {
  limit?: number;
  offset?: number;
  q?: string;
  since?: string;
  until?: string;
  project?: string;
  shared?: 1;
} = {}): Promise<SessionPage> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  const qs = sp.toString();
  return jget<SessionPage>(`/api/v1/sessions${qs ? `?${qs}` : ""}`);
}

export function fetchProjectSessions(slug: string, params: {
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
} = {}): Promise<SessionPage> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  const qs = sp.toString();
  return jget<SessionPage>(
    `/api/v1/projects/${encodeURIComponent(slug)}/sessions${qs ? `?${qs}` : ""}`,
  );
}

export function updateProject(
  slug: string,
  patch: { displayName?: string | null; hidden?: boolean },
): Promise<Project> {
  return jsend<{ project: Project }>(
    `/api/v1/projects/${encodeURIComponent(slug)}`,
    "PATCH",
    patch,
  ).then((r) => r.project);
}

export function fetchSessionDetail(id: string): Promise<SessionDetailResponse> {
  return jget<SessionDetailResponse>(
    `/api/v1/sessions/${encodeURIComponent(id)}?messages=1`,
  );
}

export function fetchShortcuts(): Promise<Shortcut[]> {
  return jget<{ shortcuts: Shortcut[] }>("/api/v1/shortcuts").then((r) => r.shortcuts);
}

export function createShortcut(input: {
  label: string;
  url: string;
  icon?: string;
  position?: number;
}): Promise<Shortcut> {
  return jsend<{ shortcut: Shortcut }>("/api/v1/shortcuts", "POST", input).then((r) => r.shortcut);
}

export function updateShortcut(
  id: string,
  patch: { label?: string; url?: string; icon?: string; position?: number },
): Promise<Shortcut> {
  return jsend<{ shortcut: Shortcut }>(
    `/api/v1/shortcuts/${encodeURIComponent(id)}`,
    "PATCH",
    patch,
  ).then((r) => r.shortcut);
}

export function deleteShortcut(id: string): Promise<void> {
  return jsend<{ ok: true }>(
    `/api/v1/shortcuts/${encodeURIComponent(id)}`,
    "DELETE",
  ).then(() => undefined);
}

export function shareSession(
  id: string,
  input: { messages?: ShareMessageInput[] } = {},
): Promise<{ url: string; localId: string }> {
  return jsend<{ url: string; localId: string }>(
    `/api/v1/sessions/${encodeURIComponent(id)}/share`,
    "POST",
    input.messages ? { messages: input.messages } : undefined,
  );
}
