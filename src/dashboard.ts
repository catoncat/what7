import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublishClient } from "./publishClient.js";
import { listen, close, openBrowser } from "./server.js";
import { StateStore, toSafeRecord } from "./state.js";
import { SessionIndexStore } from "./sessionIndex.js";
import type { ProjectInfo } from "./sessionIndex.js";
import type { ProjectPref } from "./types.js";
import { readTranscriptFile, sha256 } from "./io.js";
import { renderTranscript } from "./renderer.js";

const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 100;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST_DIR = path.resolve(__dirname, "..", "web", "dist");

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export interface DashboardOptions {
  stateDir?: string;
  port?: number;
  open?: boolean;
  /**
   * Override the cxs SQLite path. Forwarded to SessionIndexStore. Used by
   * tests to inject a fixture cxs db.
   */
  dbPath?: string;
}

export interface DashboardHandle {
  url: string;
  close: () => Promise<void>;
  server: http.Server;
}

export async function startDashboard(options: DashboardOptions = {}): Promise<DashboardHandle> {
  const publishStore = new StateStore(options.stateDir);
  const sessionStore = new SessionIndexStore(options.stateDir, options.dbPath);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      // ---------------------------------------------------------------
      // /api/v1/* — REST surface for the web/ frontend.
      // ---------------------------------------------------------------

      if (req.method === "GET" && url.pathname === "/api/v1/projects") {
        const [projects, prefs] = await Promise.all([
          sessionStore.listProjects(),
          publishStore.listProjectPrefs(),
        ]);
        return sendJson(res, { projects: mergeProjectPrefs(projects, prefs) });
      }

      const projectDetailMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
      if (req.method === "GET" && projectDetailMatch) {
        const slug = decodeURIComponent(projectDetailMatch[1] ?? "");
        const project = await sessionStore.findProjectBySlug(slug);
        if (!project) return sendJson(res, { error: "project not found" }, 404);
        const prefs = await publishStore.listProjectPrefs();
        return sendJson(res, { project: mergeProjectPrefs([project], prefs)[0] });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/sessions") {
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const q = url.searchParams.get("q") ?? undefined;
        const since = url.searchParams.get("since") ?? undefined;
        const until = url.searchParams.get("until") ?? undefined;
        const projectSlug = url.searchParams.get("project") ?? undefined;
        const sharedOnly = url.searchParams.get("shared") === "1";

        let cwd: string | undefined;
        if (projectSlug) {
          const project = await sessionStore.findProjectBySlug(projectSlug);
          if (!project) return sendJson(res, { error: "project not found" }, 404);
          cwd = project.cwd;
        }

        if (sharedOnly) {
          // Shared is a low-cardinality overlay (usually <100 records).
          // Join in-app: fetch full filtered list, keep only those whose
          // sourcePath shows up as a published record.
          const published = (await publishStore.list()).filter((r) => r.status === "published");
          const publishedPaths = new Set(published.map((r) => r.sourcePath));
          const matched = await sessionStore.list({
            query: q,
            since,
            until,
            ...(cwd ? { cwd } : {}),
            limit: MAX_PAGE_LIMIT,
            offset: 0,
          });
          const filtered = matched.filter((s) => publishedPaths.has(s.sourcePath));
          return sendJson(res, {
            sessions: filtered.slice(offset, offset + limit),
            page: { limit, offset, has_more: filtered.length > offset + limit },
          });
        }

        const sessions = await sessionStore.list({
          query: q,
          since,
          until,
          ...(cwd ? { cwd } : {}),
          limit: limit + 1,
          offset,
        });
        const hasMore = sessions.length > limit;
        return sendJson(res, {
          sessions: sessions.slice(0, limit),
          page: { limit, offset, has_more: hasMore },
        });
      }

      const projectSessionsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/sessions$/);
      if (req.method === "GET" && projectSessionsMatch) {
        const slug = decodeURIComponent(projectSessionsMatch[1] ?? "");
        const project = await sessionStore.findProjectBySlug(slug);
        if (!project) return sendJson(res, { error: "project not found" }, 404);
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const sessions = await sessionStore.list({
          cwd: project.cwd,
          since: url.searchParams.get("since") ?? undefined,
          until: url.searchParams.get("until") ?? undefined,
          limit: limit + 1,
          offset,
        });
        const hasMore = sessions.length > limit;
        return sendJson(res, {
          sessions: sessions.slice(0, limit),
          page: { limit, offset, has_more: hasMore },
        });
      }

      const v1SessionMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/);
      if (req.method === "GET" && v1SessionMatch) {
        const id = decodeURIComponent(v1SessionMatch[1] ?? "");
        const session = await sessionStore.find(id);
        if (!session) return sendJson(res, { error: "session not found" }, 404);
        const includeMessages = url.searchParams.get("messages") === "1";
        return sendJson(
          res,
          includeMessages
            ? { session, messages: await sessionStore.messages(session.id) }
            : { session },
        );
      }

      const v1ShareMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/share$/);
      if (req.method === "POST" && v1ShareMatch) {
        return publishIndexedSession(
          res,
          publishStore,
          sessionStore,
          decodeURIComponent(v1ShareMatch[1] ?? ""),
        );
      }

      if (req.method === "GET" && url.pathname === "/api/v1/shares") {
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const all = (await publishStore.list()).map(toSafeRecord);
        return sendJson(res, {
          shares: all.slice(offset, offset + limit),
          total: all.length,
        });
      }

      const shareDeleteMatch = url.pathname.match(/^\/api\/v1\/shares\/([^/]+)$/);
      if (req.method === "DELETE" && shareDeleteMatch) {
        const id = decodeURIComponent(shareDeleteMatch[1] ?? "");
        const record = await publishStore.find(id);
        if (!record) return sendJson(res, { error: `No record found for ${id}` }, 404);
        if (!record.deleteCapability) return sendJson(res, { error: "Record has no delete capability" }, 409);
        if (!record.workerUrl) return sendJson(res, { error: "Record has no workerUrl" }, 409);
        const remote = await new PublishClient({ workerUrl: record.workerUrl }).unpublish(
          record.remoteId,
          record.deleteCapability,
        );
        const updated = await publishStore.update(record.localId, {
          status: "unpublished",
          url: remote.url ?? record.url,
        });
        return sendJson(res, { share: toSafeRecord(updated), remote });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/shortcuts") {
        return sendJson(res, { shortcuts: await publishStore.listShortcuts() });
      }

      if (req.method === "POST" && url.pathname === "/api/v1/shortcuts") {
        const body = await readJson(req);
        const label = typeof body.label === "string" ? body.label.trim() : "";
        const targetUrl = typeof body.url === "string" ? body.url.trim() : "";
        if (!label || !targetUrl) return sendJson(res, { error: "label and url are required" }, 400);
        const icon = typeof body.icon === "string" ? body.icon : undefined;
        const position = typeof body.position === "number" ? body.position : undefined;
        const shortcut = await publishStore.addShortcut({
          label,
          url: targetUrl,
          ...(icon !== undefined ? { icon } : {}),
          ...(position !== undefined ? { position } : {}),
        });
        return sendJson(res, { shortcut }, 201);
      }

      const shortcutMatch = url.pathname.match(/^\/api\/v1\/shortcuts\/([^/]+)$/);
      if (req.method === "PATCH" && shortcutMatch) {
        const id = decodeURIComponent(shortcutMatch[1] ?? "");
        const body = await readJson(req);
        const patch: Parameters<StateStore["updateShortcut"]>[1] = {};
        if (typeof body.label === "string") patch.label = body.label;
        if (typeof body.url === "string") patch.url = body.url;
        if (typeof body.icon === "string") patch.icon = body.icon;
        if (typeof body.position === "number") patch.position = body.position;
        const shortcut = await publishStore.updateShortcut(id, patch);
        return sendJson(res, { shortcut });
      }
      if (req.method === "DELETE" && shortcutMatch) {
        const id = decodeURIComponent(shortcutMatch[1] ?? "");
        const ok = await publishStore.deleteShortcut(id);
        if (!ok) return sendJson(res, { error: `No shortcut found for ${id}` }, 404);
        return sendJson(res, { ok: true });
      }

      // Anything under /api/* that didn't match — return JSON 404.
      if (url.pathname.startsWith("/api/")) {
        return sendJson(res, { error: "not found" }, 404);
      }

      // Everything else (incl. "/", "/inbox", "/projects/...") — SPA frontend.
      if (req.method === "GET") return serveSpa(res, url.pathname);

      return sendJson(res, { error: "not found" }, 404);
    } catch (error) {
      return sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await listen(server, options.port ?? 0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine dashboard address");
  const url = `http://127.0.0.1:${address.port}/`;
  if (options.open) openBrowser(url);
  return { url, server, close: () => close(server) };
}

async function publishIndexedSession(res: http.ServerResponse, publishStore: StateStore, sessionStore: SessionIndexStore, id: string): Promise<void> {
  const session = await sessionStore.find(id);
  if (!session) return sendJson(res, { error: "session not found" }, 404);
  const workerUrl = process.env.WHAT7_WORKER_URL;
  const adminToken = process.env.WHAT7_ADMIN_TOKEN;
  if (!workerUrl) return sendJson(res, { error: "WHAT7_WORKER_URL is not set for this dashboard process" }, 409);
  const transcript = await readTranscriptFile(session.sourcePath);
  const rendered = renderTranscript(transcript, { sourcePath: session.sourcePath });
  const htmlDir = path.join(publishStore.dir, "html");
  await fs.mkdir(htmlDir, { recursive: true, mode: 0o700 });
  const htmlPath = path.join(htmlDir, `${safeFilename(session.id)}.html`);
  await fs.writeFile(htmlPath, rendered.html, "utf8");
  const published = await new PublishClient({ workerUrl, adminToken }).publish({
    title: rendered.title,
    html: rendered.html,
    sourcePath: session.sourcePath,
    sourceHash: sha256(await fs.readFile(session.sourcePath)),
  });
  const record = await publishStore.add({
    remoteId: published.id,
    url: published.url,
    sourcePath: session.sourcePath,
    title: rendered.title,
    deleteCapability: published.deleteToken,
    workerUrl,
    htmlPath,
  });
  return sendJson(res, { record: toSafeRecord(record), url: published.url });
}

async function serveSpa(res: http.ServerResponse, pathname: string): Promise<void> {
  const safePath = path.normalize(path.join(WEB_DIST_DIR, pathname));
  if (!safePath.startsWith(WEB_DIST_DIR)) return sendNotFound(res);
  try {
    const stat = await fs.stat(safePath);
    if (stat.isFile()) return sendFile(res, safePath);
  } catch {
    // fall through to SPA fallback
  }
  const indexPath = path.join(WEB_DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    return sendNotFound(res, "web/dist not built \u2014 run `cd web && vp build`.");
  }
  return sendFile(res, indexPath);
}

async function sendFile(res: http.ServerResponse, filePath: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const mime = STATIC_MIME[ext] ?? "application/octet-stream";
  const body = await fs.readFile(filePath);
  res.writeHead(200, { "content-type": mime, "cache-control": "no-store" });
  res.end(body);
}

function sendNotFound(res: http.ServerResponse, message = "not found"): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

function sendJson(res: http.ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function clampLimit(value: number | undefined): number {
  if (!value || value <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(value, MAX_PAGE_LIMIT);
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120);
}

/**
 * Overlay user-set `displayName` / `hidden` from state.json onto auto-derived
 * ProjectInfo rows. slug is always the derived value (source of truth for URLs).
 */
function mergeProjectPrefs(
  projects: ProjectInfo[],
  prefs: ProjectPref[],
): Array<ProjectInfo & { displayName?: string; hidden?: boolean }> {
  const byCwd = new Map(prefs.map((p) => [p.cwd, p] as const));
  return projects.map((p) => {
    const pref = byCwd.get(p.cwd);
    if (!pref) return p;
    return {
      ...p,
      ...(pref.displayName ? { displayName: pref.displayName } : {}),
      ...(pref.hidden ? { hidden: pref.hidden } : {}),
    };
  });
}
