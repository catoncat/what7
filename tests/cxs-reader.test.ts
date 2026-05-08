import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CxsReader } from "../src/cxsReader.js";
import { buildCxsFixture, sampleSessions } from "./helpers/cxsFixture.js";

describe("CxsReader", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "what7-cxs-fixture-"));
	const { dbPath } = buildCxsFixture(tmpDir, sampleSessions());
	const reader = new CxsReader(dbPath);

	afterAll(() => {
		reader.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("list() returns all sessions ordered by ended_at DESC", () => {
		const rows = reader.list();
		expect(rows.map((s) => s.id)).toEqual(["sess_a", "sess_b", "sess_c"]);
	});

	it("list() filters by cwd", () => {
		const rows = reader.list({ cwd: "/Users/test/repos/foo" });
		expect(rows.map((s) => s.id).sort()).toEqual(["sess_a", "sess_b"]);
	});

	it("list() filters by since/until on ended_at", () => {
		const rows = reader.list({ since: "2026-05-04T00:00:00.000Z" });
		// sess_c ended 30 days before 2026-05-07, so it should be excluded
		expect(rows.map((s) => s.id).sort()).toEqual(["sess_a", "sess_b"]);
	});

	it("list() filters by query against title/summary_text/compact_text", () => {
		expect(reader.list({ query: "parser" }).map((s) => s.id)).toEqual(["sess_a"]);
		expect(reader.list({ query: "vitest" }).map((s) => s.id)).toEqual(["sess_b"]);
	});

	it("find() resolves by uuid and by file_path", () => {
		expect(reader.find("sess_b")?.title).toBe("Add CI workflow");
		expect(reader.find("/codex/sess_a.jsonl")?.id).toBe("sess_a");
		expect(reader.find("missing")).toBeUndefined();
	});

	it("find() falls back to first user message for empty title", () => {
		const sessC = reader.find("sess_c");
		expect(sessC?.title).toBe("old session about watermelon clusters");
	});

	it("messages() returns rows ordered by seq", () => {
		const msgs = reader.messages("sess_a");
		expect(msgs.map((m) => m.order)).toEqual([0, 1, 2, 3]);
		expect(msgs[0]?.role).toBe("user");
		expect(msgs[3]?.role).toBe("assistant");
		expect(msgs[3]?.content).toContain("Watermelon");
	});

	it("search() falls back to LIKE when FTS5 table is missing", () => {
		const hits = reader.search("watermelon");
		expect(hits.length).toBeGreaterThan(0);
		const sessIds = new Set(hits.map((h) => h.session.id));
		expect(sessIds.has("sess_a")).toBe(true);
		expect(sessIds.has("sess_c")).toBe(true);
	});

	it("analytics() aggregates session/message counts and project rollup", () => {
		const a = reader.analytics();
		expect(a.sessionCount).toBe(3);
		expect(a.messageCount).toBe(4 + 3 + 2);
		expect(a.userMessageCount).toBe(4);
		expect(a.assistantMessageCount).toBe(5);
		expect(a.projectCount).toBe(2);
		// last 7 days: sess_a (today) + sess_b (2 days ago) — sess_c is 30 days old
		expect(a.last7dSessionCount).toBe(2);
		const byProject = Object.fromEntries(a.projects.map((p) => [p.project, p.sessionCount]));
		expect(byProject.foo).toBe(2);
		expect(byProject.bar).toBe(1);
	});

	it("listProjects() groups by cwd with basename slug", () => {
		const projects = reader.listProjects();
		expect(projects.map((p) => p.name).sort()).toEqual(["bar", "foo"]);
		const foo = projects.find((p) => p.name === "foo");
		expect(foo?.sessionCount).toBe(2);
		expect(foo?.messageCount).toBe(7);
		expect(foo?.slug).toBe("foo");
	});

	it("findProjectBySlug() resolves back to the right cwd", () => {
		const foo = reader.findProjectBySlug("foo");
		expect(foo?.cwd).toBe("/Users/test/repos/foo");
		expect(reader.findProjectBySlug("nope")).toBeUndefined();
	});
});
