import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startDashboard } from "../src/dashboard.js";
import { StateStore } from "../src/state.js";
import { listen, close } from "../src/server.js";
import { buildCxsFixture, sampleSessions } from "./helpers/cxsFixture.js";

describe("dashboard", () => {
	it("lists shares without delete capability and unpublishes through DELETE /api/v1/shares/:id", async () => {
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
		const record = await store.add({
			remoteId: "remote_dash",
			url: "http://127.0.0.1/s/remote_dash",
			sourcePath: "/tmp/session.jsonl",
			title: "Dashboard Session",
			deleteCapability: "dash-delete-token",
			workerUrl: `http://127.0.0.1:${workerAddress.port}`,
		});

		const dashboard = await startDashboard({ stateDir: dir, port: 0, open: false });

		const listed = (await (await fetch(new URL("/api/v1/shares", dashboard.url))).json()) as {
			shares: Array<Record<string, unknown>>;
			total: number;
		};
		expect(JSON.stringify(listed)).not.toContain("dash-delete-token");
		expect(listed.shares[0]?.hasDeleteCapability).toBe(true);
		expect(listed.total).toBe(1);

		const response = await fetch(new URL(`/api/v1/shares/${record.localId}`, dashboard.url), {
			method: "DELETE",
		});
		expect(response.status).toBe(200);
		expect(unpublishToken).toBe("dash-delete-token");
		expect((await store.find(record.localId))?.status).toBe("unpublished");

		await dashboard.close();
		await close(worker);
	});

	it("serves cxs sessions through /api/v1/sessions, /api/v1/projects, /api/v1/sessions/:id", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-cxs-"));
		const { dbPath } = buildCxsFixture(dir, sampleSessions());

		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

		const sessionsRes = (await (await fetch(new URL("/api/v1/sessions", dashboard.url))).json()) as {
			sessions: Array<{ id: string; project: string }>;
			page: { limit: number; offset: number; has_more: boolean };
		};
		expect(sessionsRes.sessions.map((s) => s.id)).toEqual(["sess_a", "sess_b", "sess_c"]);
		expect(sessionsRes.page.has_more).toBe(false);

		const projectsRes = (await (await fetch(new URL("/api/v1/projects", dashboard.url))).json()) as {
			projects: Array<{ slug: string; name: string; sessionCount: number }>;
		};
		const byName = Object.fromEntries(projectsRes.projects.map((p) => [p.name, p]));
		expect(byName.foo?.sessionCount).toBe(2);
		expect(byName.bar?.sessionCount).toBe(1);
		expect(byName.foo?.slug).toBe("foo");

		const fooSlug = byName.foo!.slug;
		const projectDetail = (await (
			await fetch(new URL(`/api/v1/projects/${fooSlug}`, dashboard.url))
		).json()) as { project: { slug: string; cwd: string; sessionCount: number } };
		expect(projectDetail.project.cwd).toBe("/Users/test/repos/foo");

		const projectSessionsRes = (await (
			await fetch(new URL(`/api/v1/projects/${fooSlug}/sessions`, dashboard.url))
		).json()) as { sessions: Array<{ id: string }> };
		expect(projectSessionsRes.sessions.map((s) => s.id).sort()).toEqual(["sess_a", "sess_b"]);

		const missingProject = await fetch(new URL("/api/v1/projects/nope", dashboard.url));
		expect(missingProject.status).toBe(404);

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
