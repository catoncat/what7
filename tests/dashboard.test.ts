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
		const { dbPath } = buildCxsFixture(dir, sampleSessions());
		const store = new StateStore(dir);
		const record = await store.add({
			remoteId: "remote_dash",
			url: "http://127.0.0.1/s/remote_dash",
			sourcePath: "/tmp/session.jsonl",
			title: "Dashboard Session",
			deleteCapability: "dash-delete-token",
			workerUrl: `http://127.0.0.1:${workerAddress.port}`,
		});

		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

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

	it("publishes selected edited messages through the share endpoint", async () => {
		let publishedPayload: Record<string, unknown> | undefined;
		const worker = http.createServer((req, res) => {
			if (req.method === "POST" && req.url === "/api/share") {
				let raw = "";
				req.on("data", (chunk) => { raw += String(chunk); });
				req.on("end", () => {
					publishedPayload = JSON.parse(raw) as Record<string, unknown>;
					res.writeHead(201, { "content-type": "application/json" });
					res.end(JSON.stringify({
						id: "remote_selected",
						url: "http://127.0.0.1/s/remote_selected",
						deleteToken: "selected-delete-token",
						status: "published",
					}));
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});
		await listen(worker, 0);
		const workerAddress = worker.address();
		if (!workerAddress || typeof workerAddress === "string") throw new Error("bad worker address");
		const priorWorkerUrl = process.env.WHAT7_WORKER_URL;
		const priorAdminToken = process.env.WHAT7_ADMIN_TOKEN;
		process.env.WHAT7_WORKER_URL = `http://127.0.0.1:${workerAddress.port}`;
		process.env.WHAT7_ADMIN_TOKEN = "admin-token";

		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-selected-share-"));
		const { dbPath } = buildCxsFixture(dir, sampleSessions());
		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

		try {
			const response = await fetch(new URL("/api/v1/sessions/sess_a/share", dashboard.url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					messages: [
						{ id: "sess_a:1", order: 1, content: "Edited **selection** only" },
					],
				}),
			});
			expect(response.status).toBe(200);
			const json = (await response.json()) as { record: Record<string, unknown>; url: string };
			expect(json.url).toContain("remote_selected");
			expect(JSON.stringify(json)).not.toContain("selected-delete-token");
			expect(json.record.hasDeleteCapability).toBe(true);
			expect(json.record.title).toContain("selected");

			const html = String(publishedPayload?.html ?? "");
			expect(html).toContain("Edited");
			expect(html).toContain("selection");
			expect(html).not.toContain("Refactor the parser please");
			expect(publishedPayload?.sourcePath).toBe("/codex/sess_a.jsonl");
			expect(typeof publishedPayload?.sourceHash).toBe("string");
		} finally {
			await dashboard.close();
			await close(worker);
			if (priorWorkerUrl === undefined) delete process.env.WHAT7_WORKER_URL;
			else process.env.WHAT7_WORKER_URL = priorWorkerUrl;
			if (priorAdminToken === undefined) delete process.env.WHAT7_ADMIN_TOKEN;
			else process.env.WHAT7_ADMIN_TOKEN = priorAdminToken;
		}
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

	it("filters /api/v1/sessions by project=slug and by shared=1", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-search-"));
		const { dbPath } = buildCxsFixture(dir, sampleSessions());
		// Publish sess_b so shared=1 can match it via sourcePath.
		const store = new StateStore(dir);
		await store.add({
			remoteId: "remote_sb",
			url: "http://example/s/remote_sb",
			sourcePath: "/codex/sess_b.jsonl",
			title: "Add CI workflow",
			workerUrl: "http://example",
		});

		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

		const byProject = (await (
			await fetch(new URL("/api/v1/sessions?project=foo", dashboard.url))
		).json()) as { sessions: Array<{ id: string }>; page: { has_more: boolean } };
		expect(byProject.sessions.map((s) => s.id).sort()).toEqual(["sess_a", "sess_b"]);

		const sharedOnly = (await (
			await fetch(new URL("/api/v1/sessions?shared=1", dashboard.url))
		).json()) as { sessions: Array<{ id: string }> };
		expect(sharedOnly.sessions.map((s) => s.id)).toEqual(["sess_b"]);

		const sharedBar = (await (
			await fetch(new URL("/api/v1/sessions?shared=1&project=bar", dashboard.url))
		).json()) as { sessions: Array<{ id: string }> };
		// sess_c is in bar but not published → empty.
		expect(sharedBar.sessions).toEqual([]);

		const badProject = await fetch(new URL("/api/v1/sessions?project=nope", dashboard.url));
		expect(badProject.status).toBe(404);

		await dashboard.close();
	});

	it("patches project displayName / hidden through PATCH /api/v1/projects/:slug", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-patch-"));
		const { dbPath } = buildCxsFixture(dir, sampleSessions());

		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

		const patched = (await (
			await fetch(new URL("/api/v1/projects/foo", dashboard.url), {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ displayName: "Foo Alias", hidden: true }),
			})
		).json()) as { project: { displayName?: string; hidden?: boolean; slug: string } };
		expect(patched.project.slug).toBe("foo");
		expect(patched.project.displayName).toBe("Foo Alias");
		expect(patched.project.hidden).toBe(true);

		// Fetching the list should reflect the pref overlay.
		const projects = (await (await fetch(new URL("/api/v1/projects", dashboard.url))).json()) as {
			projects: Array<{ slug: string; displayName?: string; hidden?: boolean }>;
		};
		const foo = projects.projects.find((p) => p.slug === "foo");
		expect(foo?.displayName).toBe("Foo Alias");
		expect(foo?.hidden).toBe(true);

		// Clearing works via null / false.
		const cleared = (await (
			await fetch(new URL("/api/v1/projects/foo", dashboard.url), {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ displayName: null, hidden: false }),
			})
		).json()) as { project: { displayName?: string; hidden?: boolean } };
		expect(cleared.project.displayName).toBeUndefined();
		expect(cleared.project.hidden).toBeUndefined();

		const missing = await fetch(new URL("/api/v1/projects/nope", dashboard.url), {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ displayName: "x" }),
		});
		expect(missing.status).toBe(404);

		await dashboard.close();
	});

	it("FTS5 /api/v1/sessions?q= returns message-body hits with snippet", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-dashboard-fts-"));
		const { dbPath } = buildCxsFixture(dir, sampleSessions(), { withFts5: true });

		const dashboard = await startDashboard({ stateDir: dir, dbPath, port: 0, open: false });

		// `parser` appears in sess_a's messages and title — FTS5 hits it via messages.
		const parserHits = (await (
			await fetch(new URL("/api/v1/sessions?q=parser", dashboard.url))
		).json()) as {
			sessions: Array<{ id: string; snippet?: string; bestSeq?: number }>;
		};
		const sessA = parserHits.sessions.find((s) => s.id === "sess_a");
		expect(sessA).toBeDefined();
		expect(sessA?.snippet).toMatch(/«parser»/i);
		expect(typeof sessA?.bestSeq).toBe("number");

		// `vitest` is ONLY in compact_text metadata, never in a message.
		// FTS5 path must not fabricate a hit.
		const vitestHits = (await (
			await fetch(new URL("/api/v1/sessions?q=vitest", dashboard.url))
		).json()) as { sessions: Array<unknown> };
		expect(vitestHits.sessions).toEqual([]);

		await dashboard.close();
	});
});
