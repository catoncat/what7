import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { PublishClient } from "./publishClient.js";
import { listen, close, openBrowser } from "./server.js";
import { StateStore, toSafeRecord } from "./state.js";
import { SessionIndexStore, syncSessions } from "./sessionIndex.js";
import { readTranscriptFile, sha256 } from "./io.js";
import { renderTranscript } from "./renderer.js";

export interface DashboardOptions {
  stateDir?: string;
  port?: number;
  open?: boolean;
}

export interface DashboardHandle {
  url: string;
  close: () => Promise<void>;
  server: http.Server;
}

export async function startDashboard(options: DashboardOptions = {}): Promise<DashboardHandle> {
  const publishStore = new StateStore(options.stateDir);
  const sessionStore = new SessionIndexStore(options.stateDir);
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
        return sendJson(res, { session, messages: await sessionStore.messages(session.id) });
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const sessions = await sessionStore.list({
          query: url.searchParams.get("q") ?? undefined,
          project: url.searchParams.get("project") ?? undefined,
          limit: numberParam(url.searchParams.get("limit")) ?? 200,
        });
        return sendJson(res, { sessions });
      }

      if (req.method === "GET" && url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        const hits = await sessionStore.search(q, { limit: numberParam(url.searchParams.get("limit")) ?? 200 });
        return sendJson(res, { hits });
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
        const records = (await publishStore.list()).map(toSafeRecord);
        return sendJson(res, { records });
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
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
:root { color-scheme: light dark; --bg:#f7f7fa; --panel:#fff; --inset:#edeef3; --ink:#1a1d26; --muted:#6b7280; --border:#dfe1e8; --blue:#2563eb; --purple:#7c3aed; --amber:#d97706; --green:#059669; --red:#dc2626; }
@media (prefers-color-scheme: dark) { :root { --bg:#0c0c10; --panel:#15151b; --inset:#101015; --ink:#e2e4e9; --muted:#9ca3af; --border:#2a2a35; --blue:#60a5fa; --purple:#a78bfa; --amber:#fbbf24; --green:#34d399; --red:#f87171; } }
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} button,input,select{font:inherit} a{color:var(--blue)}
.app{display:grid;grid-template-columns:360px minmax(0,1fr);height:100vh}.sidebar{border-right:1px solid var(--border);background:var(--panel);display:flex;flex-direction:column;min-width:0}.top{padding:14px;border-bottom:1px solid var(--border)}.eyebrow{margin:0 0 4px;color:var(--purple);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:24px}.toolbar{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px}input,select{padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--inset);color:var(--ink)}button{border:1px solid var(--border);border-radius:8px;background:var(--inset);color:var(--ink);padding:8px 10px;cursor:pointer}button:hover{border-color:var(--blue)}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)}.card{background:var(--inset);border:1px solid var(--border);border-radius:10px;padding:9px}.card b{display:block;font-size:20px}.card span{color:var(--muted);font-size:12px}.sessions{overflow:auto}.session{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;padding:12px 14px}.session.active{background:color-mix(in srgb,var(--blue) 12%,transparent)}.session-title{font-weight:750}.session-meta{color:var(--muted);font-size:12px;margin-top:3px}.main{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0}.mainbar{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--panel)}.main-title{min-width:0}.main-title strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.main-title span{color:var(--muted);font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}.viewer{min-height:0;background:var(--bg)}iframe{width:100%;height:100%;border:0;background:white}.empty{display:grid;place-items:center;height:100%;color:var(--muted)}.bottom{border-top:1px solid var(--border);background:var(--panel);max-height:190px;overflow:auto}.records{width:100%;border-collapse:collapse}.records td,.records th{border-bottom:1px solid var(--border);padding:8px;text-align:left}.status-published{color:var(--green);font-weight:700}.status-unpublished{color:var(--red);font-weight:700}.hits{padding:8px 14px;border-top:1px solid var(--border);max-height:180px;overflow:auto}.hit{padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer}.muted{color:var(--muted)}@media(max-width:900px){.app{grid-template-columns:1fr;height:auto}.sidebar{height:45vh}.main{height:75vh}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="top"><p class="eyebrow">local session manager</p><h1>what7</h1><div class="toolbar"><input id="q" placeholder="Search sessions/messages…"><button id="sync">Sync</button></div><p id="msg" class="muted"></p></div>
    <div class="stats" id="stats"></div>
    <div class="sessions" id="sessions"></div>
    <div class="hits" id="hits"></div>
  </aside>
  <main class="main">
    <div class="mainbar"><div class="main-title"><strong id="title">No session selected</strong><span id="subtitle">Run Sync, then choose a session.</span></div><div class="actions"><button id="publish">Publish</button><button id="openRemote">Open remote</button><button id="refresh">Refresh</button></div></div>
    <div class="viewer" id="viewer"><div class="empty">Select a session to view its transcript.</div></div>
    <div class="bottom"><table class="records"><thead><tr><th>Published</th><th>Status</th><th>URL</th><th>Action</th></tr></thead><tbody id="records"></tbody></table></div>
  </main>
</div>
<script>
let sessions=[], active=null, records=[];
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function j(url, opts){ const r=await fetch(url, opts); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||r.status); return d; }
async function loadAll(){ await Promise.all([loadAnalytics(), loadSessions(), loadRecords()]); }
async function loadAnalytics(){ const {summary}=await j('/api/analytics'); $('#stats').innerHTML=[['Sessions',summary.sessionCount],['Messages',summary.messageCount],['Tools',summary.toolCallCount],['Output tok',summary.tokenUsage.outputTokens]].map(([k,v])=>'<div class="card"><b>'+esc(v)+'</b><span>'+esc(k)+'</span></div>').join(''); }
async function loadSessions(){ const q=$('#q').value.trim(); const data=await j('/api/sessions?limit=300'+(q?'&q='+encodeURIComponent(q):'')); sessions=data.sessions||[]; $('#sessions').innerHTML=sessions.map(s=>'<button class="session '+(active?.id===s.id?'active':'')+'" data-id="'+esc(s.id)+'"><div class="session-title">'+esc(s.title||s.firstMessage||s.id)+'</div><div class="session-meta">'+esc(s.project)+' · '+esc(s.messageCount)+' msgs · '+esc(s.startedAt||s.updatedAt||'')+'</div></button>').join('')||'<p class="muted" style="padding:14px">No indexed sessions. Click Sync.</p>'; }
async function loadRecords(){ const data=await j('/api/records'); records=data.records||[]; $('#records').innerHTML=records.slice(0,20).map(r=>'<tr><td>'+esc(r.title)+'</td><td class="status-'+esc(r.status)+'">'+esc(r.status)+'</td><td><a href="'+esc(r.url)+'" target="_blank">remote</a>'+(r.htmlPath?' · <a href="/local/'+esc(r.localId)+'" target="_blank">local</a>':'')+'</td><td>'+(r.status==='published'&&r.hasDeleteCapability?'<button data-unpublish="'+esc(r.localId)+'">Unpublish</button>':'—')+'</td></tr>').join(''); }
async function selectSession(id){ const data=await j('/api/sessions/'+encodeURIComponent(id)); active=data.session; $('#title').textContent=active.title; $('#subtitle').textContent=active.id+' · '+active.sourcePath; $('#viewer').innerHTML='<iframe src="/api/sessions/'+encodeURIComponent(active.id)+'/html"></iframe>'; await loadSessions(); }
async function doSearch(){ await loadSessions(); const q=$('#q').value.trim(); if(!q){ $('#hits').innerHTML=''; return; } const data=await j('/api/search?q='+encodeURIComponent(q)+'&limit=30'); $('#hits').innerHTML=(data.hits||[]).map(h=>'<div class="hit" data-id="'+esc(h.session.id)+'"><b>'+esc(h.session.title)+'</b><br><span class="muted">line '+esc(h.message.line)+' · '+esc(h.snippet)+'</span></div>').join(''); }
$('#sessions').addEventListener('click',e=>{const b=e.target.closest('button[data-id]'); if(b) selectSession(b.dataset.id);});
$('#hits').addEventListener('click',e=>{const h=e.target.closest('[data-id]'); if(h) selectSession(h.dataset.id);});
$('#records').addEventListener('click',async e=>{const b=e.target.closest('button[data-unpublish]'); if(!b)return; $('#msg').textContent='Unpublishing…'; try{await j('/api/unpublish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.unpublish})}); $('#msg').textContent='Unpublished'; await loadRecords();}catch(err){$('#msg').textContent=err.message;}});
$('#sync').onclick=async()=>{ $('#msg').textContent='Syncing…'; try{const r=await j('/api/sync',{method:'POST'}); $('#msg').textContent='Synced '+r.indexed_sessions+'/'+r.scanned_files; await loadAll();}catch(e){$('#msg').textContent=e.message;} };
$('#refresh').onclick=loadAll;
$('#publish').onclick=async()=>{ if(!active)return; $('#msg').textContent='Publishing…'; try{const r=await j('/api/sessions/'+encodeURIComponent(active.id)+'/publish',{method:'POST'}); $('#msg').textContent='Published '+r.url; await loadRecords(); window.open(r.url,'_blank');}catch(e){$('#msg').textContent=e.message;} };
$('#openRemote').onclick=()=>{ const r=records.find(r=>active&&r.sourcePath===active.sourcePath&&r.status==='published'); if(r) window.open(r.url,'_blank'); };
let timer; $('#q').addEventListener('input',()=>{clearTimeout(timer); timer=setTimeout(doSearch,180);});
loadAll();
</script>
</body>
</html>`;
}
