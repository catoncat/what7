import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { PublishClient } from "./publishClient.js";
import { listen, close, openBrowser } from "./server.js";
import { StateStore, toSafeRecord } from "./state.js";
import { SessionIndexStore, decodeProjectId, syncSessions } from "./sessionIndex.js";
import { readTranscriptFile, sha256 } from "./io.js";
import { renderTranscript } from "./renderer.js";

const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 100;

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
      if (req.method === "GET" && url.pathname === "/") return sendHtml(res, dashboardHtml());

      const localMatch = url.pathname.match(/^\/local\/([^/]+)$/);
      if (req.method === "GET" && localMatch) return serveLocalShare(res, publishStore, decodeURIComponent(localMatch[1] ?? ""));

      const sessionHtmlMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/html$/);
      if (req.method === "GET" && sessionHtmlMatch) return serveSessionHtml(res, sessionStore, decodeURIComponent(sessionHtmlMatch[1] ?? ""));

      const sessionPublishMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/publish$/);
      if (req.method === "POST" && sessionPublishMatch) return publishIndexedSession(res, publishStore, sessionStore, decodeURIComponent(sessionPublishMatch[1] ?? ""));

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (req.method === "GET" && sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1] ?? "");
        const session = await sessionStore.find(id);
        if (!session) return sendJson(res, { error: "session not found" }, 404);
        const includeMessages = url.searchParams.get("messages") === "1";
        return sendJson(res, includeMessages ? { session, messages: await sessionStore.messages(session.id) } : { session });
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const sessions = await sessionStore.list({
          query: url.searchParams.get("q") ?? undefined,
          since: url.searchParams.get("since") ?? undefined,
          until: url.searchParams.get("until") ?? undefined,
          limit: limit + 1,
          offset,
        });
        const hasMore = sessions.length > limit;
        return sendJson(res, { sessions: sessions.slice(0, limit), page: { limit, offset, has_more: hasMore } });
      }

      if (req.method === "GET" && url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const hits = await sessionStore.search(q, {
          since: url.searchParams.get("since") ?? undefined,
          until: url.searchParams.get("until") ?? undefined,
          limit: limit + 1,
          offset,
        });
        const hasMore = hits.length > limit;
        return sendJson(res, { hits: hits.slice(0, limit), page: { limit, offset, has_more: hasMore } });
      }

      if (req.method === "GET" && url.pathname === "/api/analytics") {
        return sendJson(res, { summary: await sessionStore.analytics() });
      }

      if (req.method === "POST" && url.pathname === "/api/sync") {
        const body = await readJson(req);
        const dirs = Array.isArray(body.dirs) ? body.dirs.filter((item): item is string => typeof item === "string") : undefined;
        const result = await syncSessions({ stateDir: options.stateDir, dirs });
        return sendJson(res, { scanned_files: result.scannedFiles, indexed_sessions: result.indexedSessions, skipped_files: result.skippedFiles, roots: result.roots });
      }

      if (req.method === "GET" && url.pathname === "/api/records") {
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const all = (await publishStore.list()).map(toSafeRecord);
        const paged = all.slice(offset, offset + limit);
        return sendJson(res, { records: paged, total: all.length });
      }

      // ---------------------------------------------------------------
      // /api/v1/* — PRD §8 REST surface for the new web/ frontend.
      // ---------------------------------------------------------------

      if (req.method === "GET" && url.pathname === "/api/v1/projects") {
        return sendJson(res, { projects: await sessionStore.listProjects() });
      }

      const projectSessionsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/sessions$/);
      if (req.method === "GET" && projectSessionsMatch) {
        const projectId = decodeURIComponent(projectSessionsMatch[1] ?? "");
        const cwd = decodeProjectId(projectId);
        const limit = clampLimit(numberParam(url.searchParams.get("limit")));
        const offset = numberParam(url.searchParams.get("offset")) ?? 0;
        const sessions = await sessionStore.list({
          cwd,
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

      if (req.method === "POST" && url.pathname === "/api/unpublish") {
        const body = await readJson(req);
        const id = typeof body.id === "string" ? body.id : "";
        const record = await publishStore.find(id);
        if (!record) return sendJson(res, { error: `No record found for ${id}` }, 404);
        if (!record.deleteCapability) return sendJson(res, { error: "Record has no delete capability" }, 409);
        if (!record.workerUrl) return sendJson(res, { error: "Record has no workerUrl" }, 409);
        const client = new PublishClient({ workerUrl: record.workerUrl });
        const remote = await client.unpublish(record.remoteId, record.deleteCapability);
        const updated = await publishStore.update(record.localId, { status: "unpublished", url: remote.url ?? record.url });
        return sendJson(res, { record: toSafeRecord(updated), remote });
      }

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

async function serveLocalShare(res: http.ServerResponse, store: StateStore, id: string): Promise<void> {
  const record = await store.find(id);
  if (!record?.htmlPath) return sendJson(res, { error: "local HTML not found" }, 404);
  try {
    const html = await fs.readFile(record.htmlPath, "utf8");
    return sendHtml(res, html);
  } catch {
    return sendJson(res, { error: "local HTML not readable" }, 404);
  }
}

async function serveSessionHtml(res: http.ServerResponse, store: SessionIndexStore, id: string): Promise<void> {
  const session = await store.find(id);
  if (!session) return sendJson(res, { error: "session not found" }, 404);
  const transcript = await readTranscriptFile(session.sourcePath);
  const rendered = renderTranscript(transcript, { sourcePath: session.sourcePath });
  return sendHtml(res, rendered.html);
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

function sendHtml(res: http.ServerResponse, html: string, status = 200): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
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

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>what7 sessions</title>
<style>
:root { color-scheme: light dark; --bg:#f7f7fa; --panel:#fff; --inset:#edeef3; --ink:#1a1d26; --muted:#6b7280; --border:#dfe1e8; --blue:#2563eb; --purple:#7c3aed; --amber:#d97706; --green:#059669; --red:#dc2626; --brand-orange:#c9622d; --brand-orange-soft:#fdf0e0; --brand-orange-line:#f3d8b5; --wb-accent:#6e7eff; --font-sans-ui:Inter,"SF Pro Text",-apple-system,system-ui,sans-serif; --font-mono:"JetBrains Mono","SF Mono",Menlo,monospace; }
@media (prefers-color-scheme: dark) { :root { --bg:#0c0c10; --panel:#15151b; --inset:#101015; --ink:#e2e4e9; --muted:#8b92a0; --border:#3a3a4a; --blue:#60a5fa; --purple:#a78bfa; --amber:#fbbf24; --green:#34d399; --red:#f87171; } }
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;text-wrap:pretty} button,input,select{font:inherit} a{color:var(--blue)} h1{text-wrap:balance}
.app{display:grid;grid-template-columns:380px minmax(0,1fr);height:100vh}.sidebar{border-right:1px solid var(--border);background:var(--panel);display:flex;flex-direction:column;min-width:0}.top{padding:14px;box-shadow:0 1px 0 var(--border)}.eyebrow{margin:0 0 4px;color:var(--purple);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:24px}.toolbar{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px}.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.filters input:first-child{grid-column:1 / -1}input,select{padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--inset);color:var(--ink);min-width:0}button{border:1px solid var(--border);border-radius:8px;background:var(--inset);color:var(--ink);padding:8px 10px;cursor:pointer;min-height:40px;transition-property:border-color,transform;transition-duration:150ms;transition-timing-function:cubic-bezier(0.2,0,0,1)}button:hover{border-color:var(--blue)}button:active{transform:scale(0.96)}button.primary{background:var(--blue);border-color:var(--blue);color:white}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:12px 14px;box-shadow:0 1px 0 var(--border)}.stats-note{grid-column:1 / -1;color:var(--muted);font-size:12px}.card{background:var(--inset);border:1px solid var(--border);border-radius:10px;padding:9px}.card b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.card span{color:var(--muted);font-size:12px}.sessions{overflow:auto;min-height:0}.session{display:block;width:100%;text-align:left;border:0;box-shadow:0 1px 0 var(--border);border-radius:0;background:transparent;padding:12px 14px}.session.active{background:color-mix(in srgb,var(--blue) 12%,transparent)}.session-title{font-weight:750}.session-meta{color:var(--muted);font-size:12px;margin-top:3px}.load-more{margin:10px 14px 14px;width:calc(100% - 28px)}.main{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0}.mainbar{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;box-shadow:0 1px 0 var(--border);background:var(--panel)}.main-title{min-width:0}.main-title strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.main-title span{color:var(--muted);font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.viewer{min-height:0;background:var(--bg)}iframe{width:100%;height:100%;border:0;background:white}.empty{display:grid;place-items:center;height:100%;color:var(--muted);text-align:center;padding:20px}.bottom{box-shadow:0 -1px 0 var(--border);background:var(--panel);max-height:170px;overflow:auto}.records{width:100%;border-collapse:collapse}.records td,.records th{box-shadow:0 1px 0 var(--border);padding:8px;text-align:left}.status-published{color:var(--green);font-weight:700}.status-unpublished{color:var(--red);font-weight:700}.hits{padding:8px 14px;box-shadow:0 1px 0 var(--border);max-height:180px;overflow:auto}.hit{padding:6px 0;box-shadow:0 1px 0 var(--border);cursor:pointer}.muted{color:var(--muted)}@media(max-width:900px){.app{grid-template-columns:1fr;height:auto}.sidebar{height:48vh}.main{height:75vh}.mainbar{align-items:flex-start;flex-direction:column}.actions{justify-content:flex-start} input,select{font-size:16px}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="top">
      <p class="eyebrow">local session workbench</p><h1>what7</h1>
      <div class="toolbar"><input id="q" placeholder="Search sessions/messages…"><button id="sync">Sync</button></div>
      <div class="filters"><input id="since" type="date" title="Since"><input id="until" type="date" title="Until"></div>
      <p id="msg" class="muted">Recent sessions load first. Stats are on demand.</p>
    </div>
    <div class="stats" id="stats"><div class="stats-note">Stats on demand so large corpora do not block first paint.</div><button id="loadStats">Load stats</button></div>
    <div class="sessions" id="sessions"></div>
    <button id="moreSessions" class="load-more">Load more</button>
    <div class="hits" id="hits"></div>
  </aside>
  <main class="main">
    <div class="mainbar"><div class="main-title"><strong id="title">No session selected</strong><span id="subtitle">Choose a recent or search result.</span></div><div class="actions"><button id="share" class="primary">Share</button><button id="copyLocal">Copy link</button><button id="openLocal">Open local</button><button id="debugView">Debug view</button><button id="refresh">Refresh</button></div></div>
    <div class="viewer" id="viewer"><div class="empty">Recent sessions are loaded progressively. Select one to preview a clean transcript.</div></div>
    <div class="bottom"><table class="records"><thead><tr><th>Published</th><th>Status</th><th>URL</th><th>Action</th></tr></thead><tbody id="records"></tbody></table><button id="moreRecords" class="load-more" style="display:none">Load more records</button></div>
  </main>
</div>
<script>
let sessions=[], hits=[], active=null, records=[], sessionHasMore=false, recordsHasMore=false, recordsOffset=0;
const PAGE=30;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function j(url, opts){ const r=await fetch(url, opts); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||r.status); return d; }
function filters(){ const p=new URLSearchParams(); const q=$('#q').value.trim(); const since=$('#since').value; const until=$('#until').value; if(q)p.set('q',q); if(since)p.set('since',since); if(until)p.set('until',until); return p; }
function localUrl(extra){ if(!active)return ''; return '/api/sessions/'+encodeURIComponent(active.id)+'/html'+(extra||''); }
function renderSessions(){ $('#sessions').innerHTML=sessions.map(s=>'<button class="session '+(active?.id===s.id?'active':'')+'" data-id="'+esc(s.id)+'"><div class="session-title">'+esc(s.title||s.firstMessage||s.id)+'</div><div class="session-meta">'+esc(s.project)+' · '+esc(s.messageCount)+' msgs · '+esc(s.startedAt||s.updatedAt||'')+'</div></button>').join('')||'<p class="muted" style="padding:14px">No indexed sessions. Click Sync.</p>'; $('#moreSessions').style.display=sessionHasMore?'block':'none'; }
async function loadSessions(opts){ const reset=opts&&opts.reset; const offset=reset?0:sessions.length; const p=filters(); p.set('limit',String(PAGE)); p.set('offset',String(offset)); const data=await j('/api/sessions?'+p.toString()); sessions=reset?(data.sessions||[]):sessions.concat(data.sessions||[]); sessionHasMore=Boolean(data.page&&data.page.has_more); renderSessions(); }
async function loadStats(){ $('#stats').innerHTML='<div class="stats-note">Loading stats…</div>'; const {summary}=await j('/api/analytics'); $('#stats').innerHTML=[['Sessions',summary.sessionCount],['Messages',summary.messageCount],['Projects',summary.projectCount??0],['Last 7d',summary.last7dSessionCount??0]].map(([k,v])=>'<div class="card"><b>'+esc(v)+'</b><span>'+esc(k)+'</span></div>').join(''); }
async function loadRecords(reset){ if(reset){recordsOffset=0;records=[];} const data=await j('/api/records?limit=20&offset='+recordsOffset); const fresh=data.records||[]; records=records.concat(fresh); recordsOffset+=fresh.length; recordsHasMore=fresh.length>=20; $('#records').innerHTML=records.map(r=>'<tr><td>'+esc(r.title)+'</td><td class="status-'+esc(r.status)+'">'+esc(r.status)+'</td><td><a href="'+esc(r.url)+'" target="_blank">remote</a>'+(r.htmlPath?' · <a href="/local/'+esc(r.localId)+'" target="_blank">local</a>':'')+'</td><td>'+(r.status==='published'&&r.hasDeleteCapability?'<button data-unpublish="'+esc(r.localId)+'">Unpublish</button>':'—')+'</td></tr>').join(''); $('#moreRecords').style.display=recordsHasMore?'block':'none'; }
async function selectSession(id){ const cached=sessions.find(s=>s.id===id)||hits.find(h=>h.session.id===id)?.session; active=cached||null; if(!active){ const data=await j('/api/sessions/'+encodeURIComponent(id)); active=data.session; } $('#title').textContent=active.title; $('#subtitle').textContent=active.id+' · '+active.project+' · '+active.sourcePath; $('#viewer').innerHTML='<iframe src="'+localUrl('')+'"></iframe>'; renderSessions(); }
async function doSearch(){ await loadSessions({reset:true}); const q=$('#q').value.trim(); if(!q){ hits=[]; $('#hits').innerHTML=''; return; } const p=filters(); p.set('limit','30'); const data=await j('/api/search?'+p.toString()); hits=data.hits||[]; $('#hits').innerHTML=hits.map(h=>'<div class="hit" data-id="'+esc(h.session.id)+'"><b>'+esc(h.session.title)+'</b><br><span class="muted">line '+esc(h.message.line)+' · '+esc(h.session.project)+' · '+esc(h.snippet)+'</span></div>').join(''); }
async function refresh(){ await Promise.all([loadSessions({reset:true}), loadRecords(true)]); }
$('#sessions').addEventListener('click',e=>{const b=e.target.closest('button[data-id]'); if(b) selectSession(b.dataset.id);});
$('#hits').addEventListener('click',e=>{const h=e.target.closest('[data-id]'); if(h) selectSession(h.dataset.id);});
$('#records').addEventListener('click',async e=>{const b=e.target.closest('button[data-unpublish]'); if(!b)return; $('#msg').textContent='Unpublishing…'; try{await j('/api/unpublish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.unpublish})}); $('#msg').textContent='Unpublished'; await loadRecords(true);}catch(err){$('#msg').textContent=err.message;}});
$('#sync').onclick=async()=>{ $('#msg').textContent='Syncing…'; try{const r=await j('/api/sync',{method:'POST'}); $('#msg').textContent='Synced '+r.indexed_sessions+'/'+r.scanned_files; await refresh();}catch(e){$('#msg').textContent=e.message;} };
$('#refresh').onclick=refresh;
$('#loadStats').onclick=()=>loadStats().catch(e=>{$('#stats').innerHTML='<div class="stats-note">'+esc(e.message)+'</div>';});
$('#moreSessions').onclick=()=>loadSessions({reset:false}).catch(e=>{$('#msg').textContent=e.message;});
$('#moreRecords').onclick=()=>loadRecords(false).catch(e=>{$('#msg').textContent=e.message;});
$('#share').onclick=async()=>{ if(!active)return; $('#msg').textContent='Publishing…'; try{const r=await j('/api/sessions/'+encodeURIComponent(active.id)+'/publish',{method:'POST'}); $('#msg').textContent='Published '+r.url; await loadRecords(true); window.open(r.url,'_blank');}catch(e){$('#msg').textContent=e.message;} };
$('#copyLocal').onclick=async()=>{ if(!active)return; const url=new URL(localUrl(''), location.href).toString(); try{await navigator.clipboard.writeText(url); $('#msg').textContent='Copied '+url;}catch{ $('#msg').textContent=url; } };
$('#openLocal').onclick=()=>{ if(active) window.open(localUrl(''),'_blank'); };
$('#debugView').onclick=()=>{ if(active) window.open(localUrl('?tools=1&context=1'),'_blank'); };
let timer; for(const id of ['q','since','until']) $('#'+id).addEventListener('input',()=>{clearTimeout(timer); timer=setTimeout(doSearch,180);});
refresh();
</script>
</body>
</html>`;
}
