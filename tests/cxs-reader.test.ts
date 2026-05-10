import { afterAll, describe, expect, it } from "vitest";
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

	it("analytics() aggregates session/project counts", () => {
		const a = reader.analytics();
		expect(a.sessionCount).toBe(3);
		expect(a.projectCount).toBe(2);
		// last 7 days: sess_a (today) + sess_b (2 days ago) — sess_c is 30 days old
		expect(a.last7dSessionCount).toBe(2);
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

	it("searchMessages() LIKE fallback finds the right session and wraps snippet", () => {
		const hits = reader.searchMessages("watermelon");
		const ids = hits.map((h) => h.session.id).sort();
		expect(ids).toEqual(["sess_a", "sess_c"]);
		// Snippet wraps match with «…»
		const sessA = hits.find((h) => h.session.id === "sess_a")!;
		expect(sessA.snippet).toMatch(/«[Ww]atermelon»/);
	});

	it("searchMessages() returns [] for empty query", () => {
		expect(reader.searchMessages("")).toEqual([]);
		expect(reader.searchMessages("   ")).toEqual([]);
	});

	it("searchMessages() respects cwd filter", () => {
		const hits = reader.searchMessages("watermelon", { cwd: "/Users/test/repos/foo" });
		expect(hits.map((h) => h.session.id)).toEqual(["sess_a"]);
	});
});

describe("CxsReader FTS5", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "what7-cxs-fts5-"));
	const { dbPath } = buildCxsFixture(tmpDir, sampleSessions(), { withFts5: true });
	const reader = new CxsReader(dbPath);

	afterAll(() => {
		reader.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("searchMessages() uses messages_fts when available", () => {
		const hits = reader.searchMessages("watermelon");
		expect(hits.length).toBeGreaterThan(0);
		// FTS5 snippet() wraps with «…»
		expect(hits[0]?.snippet).toMatch(/«[Ww]atermelon»/);
	});

	it("searchMessages() only matches message content, not session metadata", () => {
		// `parser` appears in sess_a's title AND in messages — both paths find it.
		// `vitest` appears ONLY in sess_b's compact_text (metadata), not any message.
		// LIKE path (which matches title/summary/compact) would find sess_b;
		// FTS5 path (message content only) must NOT.
		const hits = reader.searchMessages("vitest");
		expect(hits).toEqual([]);
	});

	it("searchMessages() bestSeq points at the message with the match", () => {
		const hits = reader.searchMessages("parser");
		const sessA = hits.find((h) => h.session.id === "sess_a");
		expect(sessA).toBeDefined();
		// Messages 0 and 1 contain 'parser'; bestSeq should be one of them.
		expect([0, 1]).toContain(sessA?.bestSeq);
	});
});
