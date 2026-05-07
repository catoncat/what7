import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import type {
	AnalyticsSummary,
	ListSessionFilters,
	ManagedMessage,
	ManagedSession,
	ProjectInfo,
	SearchHit,
	TokenUsageSummary,
} from "./sessionIndex.js";
import type { MessageRole } from "./types.js";

/**
 * Default cxs SQLite index path. Override with the `CXS_DB` env var or the
 * `dbPath` constructor argument.
 */
export const DEFAULT_CXS_DB_PATH =
	process.env.CXS_DB ?? path.join(os.homedir(), ".local", "state", "cxs", "index.sqlite");

const ZERO_USAGE: TokenUsageSummary = {
	inputTokens: 0,
	outputTokens: 0,
	cachedInputTokens: 0,
	reasoningOutputTokens: 0,
	totalTokens: 0,
	estimatedCostUsd: null,
};

interface SessionRow {
	session_uuid: string;
	file_path: string;
	title: string;
	cwd: string;
	model: string;
	started_at: string;
	ended_at: string;
	message_count: number;
	raw_file_size: number;
	raw_file_mtime: number;
	user_count: number;
	assistant_count: number;
	first_user_message: string | null;
}

interface MessageHitRow {
	session_uuid: string;
	seq: number;
	role: string;
	content_text: string;
	timestamp: string;
	snip: string;
}

const SESSION_COLUMNS = `
	s.session_uuid AS session_uuid,
	s.file_path    AS file_path,
	s.title        AS title,
	s.cwd          AS cwd,
	s.model        AS model,
	s.started_at   AS started_at,
	s.ended_at     AS ended_at,
	s.message_count   AS message_count,
	s.raw_file_size   AS raw_file_size,
	s.raw_file_mtime  AS raw_file_mtime,
	COALESCE((SELECT COUNT(*) FROM messages m WHERE m.session_uuid = s.session_uuid AND m.role = 'user'), 0) AS user_count,
	COALESCE((SELECT COUNT(*) FROM messages m WHERE m.session_uuid = s.session_uuid AND m.role = 'assistant'), 0) AS assistant_count,
	(SELECT m.content_text FROM messages m WHERE m.session_uuid = s.session_uuid AND m.role = 'user' ORDER BY m.seq LIMIT 1) AS first_user_message
`;

/**
 * Read-only adapter over the cxs SQLite index (`~/.local/state/cxs/index.sqlite`).
 *
 * what7 PRD red-line: we never write here. cxs owns this index and incremental sync.
 * If the file is missing, instantiating throws — call `cxs sync` first.
 */
export class CxsReader {
	readonly dbPath: string;
	private readonly db: Database.Database;

	constructor(dbPath: string = DEFAULT_CXS_DB_PATH) {
		this.dbPath = dbPath;
		this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
	}

	close(): void {
		this.db.close();
	}

	list(filters: ListSessionFilters = {}): ManagedSession[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (filters.cwd) {
			where.push("s.cwd = ?");
			params.push(filters.cwd);
		}
		if (filters.since) {
			where.push("s.ended_at >= ?");
			params.push(filters.since);
		}
		if (filters.until) {
			where.push("s.ended_at <= ?");
			params.push(filters.until);
		}
		if (filters.query) {
			where.push("(s.title LIKE ? OR s.summary_text LIKE ? OR s.compact_text LIKE ?)");
			const q = `%${filters.query}%`;
			params.push(q, q, q);
		}
		const limit = clampLimit(filters.limit, 30, 500);
		const offset = Math.max(0, filters.offset ?? 0);
		const sql = `
			SELECT ${SESSION_COLUMNS}
			FROM sessions s
			${where.length ? `WHERE ${where.join(" AND ")}` : ""}
			ORDER BY s.ended_at DESC
			LIMIT ? OFFSET ?
		`;
		const rows = this.db.prepare(sql).all(...params, limit, offset) as SessionRow[];
		return rows.map(rowToSession);
	}

	find(idOrPath: string): ManagedSession | undefined {
		const sql = `
			SELECT ${SESSION_COLUMNS}
			FROM sessions s
			WHERE s.session_uuid = ? OR s.file_path = ?
			LIMIT 1
		`;
		const row = this.db.prepare(sql).get(idOrPath, idOrPath) as SessionRow | undefined;
		return row ? rowToSession(row) : undefined;
	}

	messages(sessionUuid: string): ManagedMessage[] {
		const sql = `
			SELECT seq, role, content_text, timestamp
			FROM messages
			WHERE session_uuid = ?
			ORDER BY seq ASC
		`;
		const rows = this.db.prepare(sql).all(sessionUuid) as Array<{
			seq: number;
			role: string;
			content_text: string;
			timestamp: string;
		}>;
		return rows.map((r) => ({
			id: `${sessionUuid}:${r.seq}`,
			sessionId: sessionUuid,
			order: r.seq,
			line: r.seq,
			kind: "message" as const,
			role: normalizeRole(r.role),
			timestamp: r.timestamp,
			title: deriveTitle(r.content_text),
			content: r.content_text,
		}));
	}

	search(query: string, filters: ListSessionFilters = {}): SearchHit[] {
		const q = query.trim();
		if (!q) return [];
		const limit = clampLimit(filters.limit, 30, 200);
		const offset = Math.max(0, filters.offset ?? 0);

		let rows: MessageHitRow[] = [];
		try {
			const ftsSql = `
				SELECT m.session_uuid AS session_uuid, m.seq AS seq, m.role AS role,
				       m.content_text AS content_text, m.timestamp AS timestamp,
				       snippet(messages_fts, 0, '«', '»', '…', 12) AS snip
				FROM messages_fts
				JOIN messages m
				  ON m.session_uuid = messages_fts.session_uuid AND m.seq = messages_fts.seq
				WHERE messages_fts MATCH ?
				ORDER BY rank
				LIMIT ? OFFSET ?
			`;
			rows = this.db.prepare(ftsSql).all(escapeFtsQuery(q), limit, offset) as MessageHitRow[];
		} catch {
			const likeSql = `
				SELECT session_uuid, seq, role, content_text, timestamp,
				       substr(content_text, 1, 240) AS snip
				FROM messages
				WHERE content_text LIKE ?
				ORDER BY timestamp DESC
				LIMIT ? OFFSET ?
			`;
			rows = this.db.prepare(likeSql).all(`%${q}%`, limit, offset) as MessageHitRow[];
		}

		const sessionsByUuid = new Map<string, ManagedSession>();
		for (const r of rows) {
			if (sessionsByUuid.has(r.session_uuid)) continue;
			const session = this.find(r.session_uuid);
			if (session) sessionsByUuid.set(r.session_uuid, session);
		}

		const hits: SearchHit[] = [];
		for (const r of rows) {
			const session = sessionsByUuid.get(r.session_uuid);
			if (!session) continue;
			if (filters.cwd && session.project !== filters.cwd && !session.sourcePath.startsWith(filters.cwd)) continue;
			if (filters.since && (session.endedAt ?? session.startedAt ?? "") < filters.since) continue;
			if (filters.until && (session.endedAt ?? session.startedAt ?? "") > filters.until) continue;
			hits.push(buildHit(session, r));
		}
		return hits;
	}

	analytics(): AnalyticsSummary {
		const totals = this.db
			.prepare(
				`SELECT COUNT(*) AS sessionCount, COALESCE(SUM(message_count), 0) AS messageCount FROM sessions`,
			)
			.get() as { sessionCount: number; messageCount: number };

		const roleCounts = this.db
			.prepare(`SELECT role, COUNT(*) AS c FROM messages GROUP BY role`)
			.all() as Array<{ role: string; c: number }>;
		const userMessageCount = roleCounts.find((r) => r.role === "user")?.c ?? 0;
		const assistantMessageCount = roleCounts.find((r) => r.role === "assistant")?.c ?? 0;

		const projects = this.db
			.prepare(
				`SELECT cwd AS rawCwd, COUNT(*) AS sessionCount, COALESCE(SUM(message_count), 0) AS messageCount
				 FROM sessions GROUP BY cwd ORDER BY sessionCount DESC`,
			)
			.all() as Array<{ rawCwd: string; sessionCount: number; messageCount: number }>;

		const dailyRows = this.db
			.prepare(
				`SELECT substr(ended_at, 1, 10) AS date, COUNT(*) AS sessions, COALESCE(SUM(message_count), 0) AS messages
				 FROM sessions GROUP BY date ORDER BY date DESC LIMIT 90`,
			)
			.all() as Array<{ date: string; sessions: number; messages: number }>;

		const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
		const last7d = this.db
			.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE ended_at >= ?`)
			.get(sevenDaysAgo) as { c: number };

		return {
			sessionCount: totals.sessionCount,
			messageCount: totals.messageCount,
			userMessageCount,
			assistantMessageCount,
			toolCallCount: 0,
			toolResultCount: 0,
			totalDurationMs: 0,
			tokenUsage: { ...ZERO_USAGE },
			projects: projects.map((p) => ({
				project: path.basename(p.rawCwd) || p.rawCwd,
				sessionCount: p.sessionCount,
				messageCount: p.messageCount,
			})),
			agents: [{ agent: "codex", sessionCount: totals.sessionCount }],
			tools: [],
			daily: dailyRows
				.map((d) => ({ date: d.date, sessions: d.sessions, messages: d.messages, outputTokens: 0 }))
				.reverse(),
			projectCount: projects.length,
			last7dSessionCount: last7d.c,
		};
	}

	listProjects(): ProjectInfo[] {
		const rows = this.db
			.prepare(
				`SELECT cwd AS cwd,
				        COUNT(*) AS sessionCount,
				        COALESCE(SUM(message_count), 0) AS messageCount,
				        MAX(ended_at) AS lastSessionAt
				   FROM sessions
				  GROUP BY cwd
				  ORDER BY lastSessionAt DESC`,
			)
			.all() as Array<{
				cwd: string;
				sessionCount: number;
				messageCount: number;
				lastSessionAt: string | null;
			}>;
		return rows.map((r) => ({
			id: encodeProjectId(r.cwd),
			name: path.basename(r.cwd),
			cwd: r.cwd,
			sessionCount: r.sessionCount,
			messageCount: r.messageCount,
			lastSessionAt: r.lastSessionAt,
		}));
	}
}

function rowToSession(row: SessionRow): ManagedSession {
	const firstMsg = (row.first_user_message ?? "").trim();
	return {
		id: row.session_uuid,
		agent: "codex",
		title: row.title || firstMsg.slice(0, 80) || row.session_uuid,
		project: path.basename(row.cwd) || row.cwd,
		sourcePath: row.file_path,
		sourceSize: row.raw_file_size,
		sourceMtimeMs: row.raw_file_mtime,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		updatedAt: row.ended_at,
		model: row.model || undefined,
		lineCount: 0,
		messageCount: row.message_count,
		userMessageCount: row.user_count,
		assistantMessageCount: row.assistant_count,
		toolCallCount: 0,
		toolResultCount: 0,
		reasoningCount: 0,
		firstMessage: firstMsg.slice(0, 200),
		tokenUsage: { ...ZERO_USAGE },
		toolUsage: {},
	};
}

function buildHit(session: ManagedSession, row: MessageHitRow): SearchHit {
	return {
		session,
		message: {
			id: `${row.session_uuid}:${row.seq}`,
			sessionId: row.session_uuid,
			order: row.seq,
			line: row.seq,
			kind: "message",
			role: normalizeRole(row.role),
			timestamp: row.timestamp,
			title: deriveTitle(row.content_text),
			content: row.content_text,
		},
		snippet: row.snip || row.content_text.slice(0, 240),
	};
}

function normalizeRole(role: string): MessageRole {
	if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
	return "unknown";
}

function deriveTitle(content: string): string {
	const firstLine = content.trim().split(/\r?\n/)[0] ?? "";
	return firstLine.slice(0, 80);
}

function escapeFtsQuery(q: string): string {
	return `"${q.replace(/"/g, '""')}"`;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
	const v = value ?? fallback;
	if (!Number.isFinite(v) || v <= 0) return fallback;
	return Math.min(Math.floor(v), max);
}

export function encodeProjectId(cwd: string): string {
	return Buffer.from(cwd, "utf8").toString("base64url");
}

export function decodeProjectId(id: string): string {
	return Buffer.from(id, "base64url").toString("utf8");
}
