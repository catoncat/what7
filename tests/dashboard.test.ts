import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startDashboard } from "../src/dashboard.js";
import { StateStore } from "../src/state.js";
import { listen, close } from "../src/server.js";
import { encodeProjectId } from "../src/cxsReader.js";
import { buildCxsFixture, sampleSessions } from "./helpers/cxsFixture.js";

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

	it("serves cxs sessions through /api/sessions, /api/v1/projects, /api/v1/sessions/:id", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-cxs-"));
		const { dbPath } = buildCxsFixture(dir, sampleSessions());

		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

		const sessionsRes = (await (await fetch(new URL("/api/sessions", dashboard.url))).json()) as {
			sessions: Array<{ id: string; project: string }>;
			page: { limit: number; offset: number; has_more: boolean };
		};
		expect(sessionsRes.sessions.map((s) => s.id)).toEqual(["sess_a", "sess_b", "sess_c"]);
		expect(sessionsRes.page.has_more).toBe(false);

		const projectsRes = (await (await fetch(new URL("/api/v1/projects", dashboard.url))).json()) as {
			projects: Array<{ id: string; name: string; sessionCount: number }>;
		};
		const byName = Object.fromEntries(projectsRes.projects.map((p) => [p.name, p]));
		expect(byName.foo?.sessionCount).toBe(2);
		expect(byName.bar?.sessionCount).toBe(1);
		expect(byName.foo?.id).toBe(encodeProjectId("/Users/test/repos/foo"));

		const fooId = byName.foo!.id;
		const projectSessionsRes = (await (
			await fetch(new URL(`/api/v1/projects/${fooId}/sessions`, dashboard.url))
		).json()) as { sessions: Array<{ id: string }> };
		expect(projectSessionsRes.sessions.map((s) => s.id).sort()).toEqual(["sess_a", "sess_b"]);

		const sessionWithMessages = (await (
			await fetch(new URL("/api/v1/sessions/sess_a?messages=1", dashboard.url))
		).json()) as {
			session: { id: string; project: string };
			messages: Array<{ order: number; role: string }>;
		};
		expect(sessionWithMessages.session.id).toBe("sess_a");
		expect(sessionWithMessages.session.project).toBe("foo");
		expect(sessionWithMessages.messages.map((m) => m.order)).toEqual([0, 1, 2, 3]);

		const missing = await fetch(new URL("/api/v1/sessions/missing", dashboard.url));
		expect(missing.status).toBe(404);

		await dashboard.close();
	});
});
