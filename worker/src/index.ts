interface SharePayload {
  title: string;
  html: string;
  sourcePath?: string;
  sourceHash?: string;
}

interface StoredShare {
  id: string;
  title: string;
  html: string;
  sourcePath?: string;
  sourceHash?: string;
  createdAt: string;
  updatedAt: string;
  status: "published" | "unpublished";
  deleteTokenHash: string;
}

const MAX_HTML_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", error: error instanceof Error ? error.message : String(error) }));
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<What7Env>;

type What7Env = Env & { WHAT7_ADMIN_TOKEN?: string };

async function route(request: Request, env: What7Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
    return new Response(request.method === "HEAD" ? null : "what7 share worker", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const shareMatch = url.pathname.match(/^\/s\/([^/]+)$/);
  if ((request.method === "GET" || request.method === "HEAD") && shareMatch) {
    return getShare(env, shareMatch[1] ?? "", request.method === "HEAD");
  }

  if (request.method === "POST" && url.pathname === "/api/share") {
    return publish(request, env);
  }

  const unpublishMatch = url.pathname.match(/^\/api\/share\/([^/]+)(?:\/unpublish)?$/);
  if ((request.method === "POST" || request.method === "DELETE") && unpublishMatch) {
    return unpublish(request, env, unpublishMatch[1] ?? "");
  }

  return json({ error: "not found" }, 404);
}

async function getShare(env: What7Env, id: string, head = false): Promise<Response> {
  const stored = await readShare(env, id);
  if (!stored) return notFound();
  if (stored.status !== "published") return unpublished();
  return new Response(head ? null : stored.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function publish(request: Request, env: What7Env): Promise<Response> {
  const authorized = await isAdminAuthorized(request, env);
  if (!authorized) return json({ error: "unauthorized" }, 401);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_HTML_BYTES) return json({ error: "share artifact too large" }, 413);

  const payload = (await request.json()) as Partial<SharePayload>;
  if (!payload.html || typeof payload.html !== "string") return json({ error: "html is required" }, 400);
  if (byteLength(payload.html) > MAX_HTML_BYTES) return json({ error: "share artifact too large" }, 413);

  const id = makeToken(16);
  const deleteToken = makeToken(32);
  const now = new Date().toISOString();
  const stored: StoredShare = {
    id,
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title.slice(0, 200) : "what7 share",
    html: payload.html,
    sourcePath: typeof payload.sourcePath === "string" ? payload.sourcePath.slice(0, 1000) : undefined,
    sourceHash: typeof payload.sourceHash === "string" ? payload.sourceHash.slice(0, 128) : undefined,
    createdAt: now,
    updatedAt: now,
    status: "published",
    deleteTokenHash: await sha256(deleteToken),
  };
  await env.WHAT7_SHARES.put(key(id), JSON.stringify(stored));
  const url = new URL(`/s/${id}`, request.url).toString();
  return json({ id, url, deleteToken, status: "published" }, 201);
}

async function unpublish(request: Request, env: What7Env, id: string): Promise<Response> {
  const stored = await readShare(env, id);
  if (!stored) return json({ error: "share not found" }, 404);
  const token = request.headers.get("x-what7-delete-token") ?? (await readDeleteTokenFromBody(request));
  if (!token) return json({ error: "delete token is required" }, 401);
  const tokenOk = await timingSafeEqual(await sha256(token), stored.deleteTokenHash);
  if (!tokenOk) return json({ error: "unauthorized" }, 401);
  const now = new Date().toISOString();
  const next: StoredShare = { ...stored, html: "", status: "unpublished", updatedAt: now };
  await env.WHAT7_SHARES.put(key(id), JSON.stringify(next));
  const url = new URL(`/s/${id}`, request.url).toString();
  return json({ id, status: "unpublished", url });
}

async function readDeleteTokenFromBody(request: Request): Promise<string | undefined> {
  if (!request.headers.get("content-type")?.includes("application/json")) return undefined;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return typeof body.deleteToken === "string" ? body.deleteToken : undefined;
}

async function isAdminAuthorized(request: Request, env: What7Env): Promise<boolean> {
  const configured = env.WHAT7_ADMIN_TOKEN;
  if (!configured) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? request.headers.get("x-what7-admin-token") ?? "";
  if (!token) return false;
  return timingSafeEqual(await sha256(token), await sha256(configured));
}

async function readShare(env: What7Env, id: string): Promise<StoredShare | undefined> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return undefined;
  const raw = await env.WHAT7_SHARES.get(key(id));
  if (!raw) return undefined;
  return JSON.parse(raw) as StoredShare;
}

function key(id: string): string {
  return `share:${id}`;
}

function makeToken(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function unpublished(): Response {
  return new Response("<!doctype html><title>Unpublished</title><h1>This what7 share has been unpublished.</h1>", {
    status: 410,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
