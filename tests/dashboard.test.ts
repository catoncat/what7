import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startDashboard } from "../src/dashboard.js";
import { StateStore } from "../src/state.js";
import { SessionIndexStore, type ManagedSession } from "../src/sessionIndex.js";
import { listen, close } from "../src/server.js";

describe("dashboard", () => {
  it("lists records without delete capability and unpublishes through the local backend", async () => {
    let unpublishToken = "";
    const worker = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/share/remote_dash/unpublish") {
        unpublishToken = String(req.headers["x-what7-delete-token"] ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "remote_dash", status: "unpublished", url: "http://127.0.0.1/s/remote_dash" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await listen(worker, 0);
    const workerAddress = worker.address();
    if (!workerAddress || typeof workerAddress === "string") throw new Error("bad worker address");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-"));
    const store = new StateStore(dir);
    const htmlPath = path.join(dir, "record.html");
    await fs.writeFile(htmlPath, "<h1>local html</h1>");
    const record = await store.add({
      remoteId: "remote_dash",
      url: "http://127.0.0.1/s/remote_dash",
      sourcePath: "/tmp/session.jsonl",
      title: "Dashboard Session",
      deleteCapability: "dash-delete-token",
      workerUrl: `http://127.0.0.1:${workerAddress.port}`,
      htmlPath,
    });

    const dashboard = await startDashboard({ stateDir: dir, port: 0, open: false });
    const listed = (await (await fetch(new URL("/api/records", dashboard.url))).json()) as { records: Array<Record<string, unknown>> };
    expect(JSON.stringify(listed)).not.toContain("dash-delete-token");
    expect(listed.records[0]?.hasDeleteCapability).toBe(true);
    const localHtml = await fetch(new URL(`/local/${record.localId}`, dashboard.url));
    expect(localHtml.status).toBe(200);
    expect(await localHtml.text()).toContain("local html");

    const response = await fetch(new URL("/api/unpublish", dashboard.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: record.localId }),
    });
    expect(response.status).toBe(200);
    expect(unpublishToken).toBe("dash-delete-token");
    expect((await store.find(record.localId))?.status).toBe("unpublished");

    await dashboard.close();
    await close(worker);
  });

  it("serves a bounded recent-session page and keeps analytics out of the first-load path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-large-"));
    const sessions = Array.from({ length: 75 }, (_, index): ManagedSession => {
      const n = String(index).padStart(2, "0");
      const timestamp = new Date(Date.parse("2026-05-01T00:00:00.000Z") + index * 60_000).toISOString();
      return {
        id: `codex:s${n}`,
        agent: "codex",
        title: `Session ${n}`,
        project: index % 2 === 0 ? "what7" : "other",
        sourcePath: path.join(dir, `s${n}.jsonl`),
        sourceSize: 10,
        sourceMtimeMs: Date.parse(timestamp),
        startedAt: timestamp,
        endedAt: new Date(Date.parse(timestamp) + 1000).toISOString(),
        updatedAt: timestamp,
        model: "gpt-5",
        lineCount: 2,
        messageCount: 2,
        userMessageCount: 1,
        assistantMessageCount: 1,
        toolCallCount: 0,
        toolResultCount: 0,
        reasoningCount: 0,
        firstMessage: `Question ${n}`,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: null,
        },
        toolUsage: {},
      };
    });
    await new SessionIndexStore(dir).save({ version: 1, roots: [dir], sessions, messages: [] });

    const dashboard = await startDashboard({ stateDir: dir, port: 0, open: false });
    const html = await (await fetch(dashboard.url)).text();
    expect(html).toContain("Stats on demand");
    expect(html).not.toContain("loadAnalytics();");
    expect(html).toContain("const cached=sessions.find");
    expect(html.indexOf("const cached=sessions.find")).toBeLessThan(html.indexOf("if(!active){ const data=await j('/api/sessions/'+encodeURIComponent(id));"));

    const initial = (await (await fetch(new URL("/api/sessions", dashboard.url))).json()) as {
      sessions: ManagedSession[];
      page: { limit: number; offset: number; has_more: boolean };
    };
    expect(initial.sessions).toHaveLength(30);
    expect(initial.page).toEqual({ limit: 30, offset: 0, has_more: true });
    expect(initial.sessions[0]?.id).toBe("codex:s74");

    const next = (await (await fetch(new URL("/api/sessions?offset=30&limit=30", dashboard.url))).json()) as {
      sessions: ManagedSession[];
      page: { limit: number; offset: number; has_more: boolean };
    };
    expect(next.sessions).toHaveLength(30);
    expect(next.page).toEqual({ limit: 30, offset: 30, has_more: true });
    expect(next.sessions[0]?.id).toBe("codex:s44");

    await dashboard.close();
  });

  it("returns session metadata without loading timeline messages unless explicitly requested", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-metadata-"));
    const session: ManagedSession = {
      id: "codex:fast",
      agent: "codex",
      title: "Fast metadata",
      project: "what7",
      sourcePath: path.join(dir, "fast.jsonl"),
      sourceSize: 10,
      sourceMtimeMs: Date.parse("2026-05-01T00:00:00.000Z"),
      startedAt: "2026-05-01T00:00:00.000Z",
      endedAt: "2026-05-01T00:00:01.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      model: "gpt-5",
      lineCount: 2,
      messageCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      reasoningCount: 0,
      firstMessage: "hello",
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null,
      },
      toolUsage: {},
    };
    await new SessionIndexStore(dir).save({
      version: 1,
      roots: [dir],
      sessions: [session],
      messages: [],
    });
    await fs.writeFile(path.join(dir, "messages.jsonl"), JSON.stringify({
      id: "codex:fast:1",
      sessionId: "codex:fast",
      order: 1,
      line: 1,
      kind: "message",
      role: "user",
      title: "user",
      content: "loaded only on demand",
    }) + "\n");

    const dashboard = await startDashboard({ stateDir: dir, port: 0, open: false });
    const metadataOnly = await (await fetch(new URL("/api/sessions/codex%3Afast", dashboard.url))).json() as Record<string, unknown>;
    expect(metadataOnly).toEqual({ session });

    const withMessages = await (await fetch(new URL("/api/sessions/codex%3Afast?messages=1", dashboard.url))).json() as {
      session: ManagedSession;
      messages: Array<{ content: string }>;
    };
    expect(withMessages.session.id).toBe("codex:fast");
    expect(withMessages.messages[0]?.content).toBe("loaded only on demand");

    await dashboard.close();
  });
});
