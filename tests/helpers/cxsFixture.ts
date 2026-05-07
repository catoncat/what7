import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Build a fixture SQLite db that mirrors the columns CxsReader reads from the
 * real cxs index. We intentionally omit the FTS5 virtual tables so that
 * CxsReader.search() exercises its LIKE fallback branch.
 *
 * Returns the absolute db path. The caller is responsible for cleaning up
 * the temp directory if needed.
 */
export interface FixtureSession {
	session_uuid: string;
	file_path: string;
	title: string;
	cwd: string;
	model: string;
	started_at: string;
	ended_at: string;
	summary_text?: string | null;
	compact_text?: string | null;
	raw_file_size?: number;
	raw_file_mtime?: number;
	messages: Array<{ seq: number; role: string; content_text: string; timestamp: string }>;
}

export interface FixtureBuildResult {
	dbPath: string;
	sessions: FixtureSession[];
}

export function buildCxsFixture(dir: string, sessions: FixtureSession[]): FixtureBuildResult {
	fs.mkdirSync(dir, { recursive: true });
	const dbPath = path.join(dir, "cxs-fixture.sqlite");
	if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE sessions (
			session_uuid TEXT PRIMARY KEY,
			file_path TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			cwd TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			started_at TEXT NOT NULL DEFAULT '',
			ended_at TEXT NOT NULL DEFAULT '',
			message_count INTEGER NOT NULL DEFAULT 0,
			raw_file_size INTEGER NOT NULL DEFAULT 0,
			raw_file_mtime INTEGER NOT NULL DEFAULT 0,
			summary_text TEXT,
			compact_text TEXT
		);
		CREATE TABLE messages (
			session_uuid TEXT NOT NULL,
			seq INTEGER NOT NULL,
			role TEXT NOT NULL,
			content_text TEXT NOT NULL,
			timestamp TEXT NOT NULL DEFAULT '',
			UNIQUE(session_uuid, seq)
		);
		CREATE INDEX idx_messages_session ON messages(session_uuid);
	`);

	const insertSession = db.prepare(`
		INSERT INTO sessions (session_uuid, file_path, title, cwd, model, started_at, ended_at,
		                      message_count, raw_file_size, raw_file_mtime, summary_text, compact_text)
		VALUES (@session_uuid, @file_path, @title, @cwd, @model, @started_at, @ended_at,
		        @message_count, @raw_file_size, @raw_file_mtime, @summary_text, @compact_text)
	`);
	const insertMessage = db.prepare(`
		INSERT INTO messages (session_uuid, seq, role, content_text, timestamp)
		VALUES (?, ?, ?, ?, ?)
	`);

	const tx = db.transaction((batch: FixtureSession[]) => {
		for (const s of batch) {
			insertSession.run({
				session_uuid: s.session_uuid,
				file_path: s.file_path,
				title: s.title,
				cwd: s.cwd,
				model: s.model,
				started_at: s.started_at,
				ended_at: s.ended_at,
				message_count: s.messages.length,
				raw_file_size: s.raw_file_size ?? 4096,
				raw_file_mtime: s.raw_file_mtime ?? Date.parse(s.ended_at),
				summary_text: s.summary_text ?? null,
				compact_text: s.compact_text ?? null,
			});
			for (const m of s.messages) {
				insertMessage.run(s.session_uuid, m.seq, m.role, m.content_text, m.timestamp);
			}
		}
	});
	tx(sessions);
	db.close();

	return { dbPath, sessions };
}

/**
 * Sample dataset used by tests. Three sessions across two cwds with deterministic timestamps.
 * The most recent session is for `/Users/test/repos/foo` (sess_a),
 * the oldest is `/Users/test/repos/bar` (sess_c).
 */
export function sampleSessions(): FixtureSession[] {
	const now = new Date("2026-05-07T12:00:00.000Z");
	const day = 86_400_000;
	const iso = (offsetDays: number, offsetMin = 0) =>
		new Date(now.getTime() - offsetDays * day + offsetMin * 60_000).toISOString();

	return [
		{
			session_uuid: "sess_a",
			file_path: "/codex/sess_a.jsonl",
			title: "Refactor parser layer",
			cwd: "/Users/test/repos/foo",
			model: "gpt-5",
			started_at: iso(0, 0),
			ended_at: iso(0, 30),
			summary_text: "Cleaned up legacy parser code.",
			compact_text: null,
			messages: [
				{ seq: 0, role: "user", content_text: "Refactor the parser please", timestamp: iso(0, 0) },
				{ seq: 1, role: "assistant", content_text: "Plan: split parser into stages", timestamp: iso(0, 1) },
				{ seq: 2, role: "user", content_text: "sounds good", timestamp: iso(0, 2) },
				{ seq: 3, role: "assistant", content_text: "Done. Watermelon fields renamed.", timestamp: iso(0, 30) },
			],
		},
		{
			session_uuid: "sess_b",
			file_path: "/codex/sess_b.jsonl",
			title: "Add CI workflow",
			cwd: "/Users/test/repos/foo",
			model: "gpt-5",
			started_at: iso(2, 0),
			ended_at: iso(2, 20),
			summary_text: null,
			compact_text: "Set up vitest + typecheck pipeline.",
			messages: [
				{ seq: 0, role: "user", content_text: "add a CI workflow", timestamp: iso(2, 0) },
				{ seq: 1, role: "assistant", content_text: "Created .github/workflows/ci.yml", timestamp: iso(2, 5) },
				{ seq: 2, role: "assistant", content_text: "All green.", timestamp: iso(2, 20) },
			],
		},
		{
			session_uuid: "sess_c",
			file_path: "/codex/sess_c.jsonl",
			title: "", // empty title to exercise fallback to first user message
			cwd: "/Users/test/repos/bar",
			model: "gpt-4o",
			started_at: iso(30, 0),
			ended_at: iso(30, 10),
			summary_text: null,
			compact_text: null,
			messages: [
				{ seq: 0, role: "user", content_text: "old session about watermelon clusters", timestamp: iso(30, 0) },
				{ seq: 1, role: "assistant", content_text: "ok", timestamp: iso(30, 10) },
			],
		},
	];
}
