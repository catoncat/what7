import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import { deriveSlugs } from "./projects.js";
import type {
	AnalyticsSummary,
	ListSessionFilters,
	ManagedMessage,
	ManagedSession,
	ProjectInfo,
	SearchHit,
} from "./sessionIndex.js";
import type { MessageRole } from "./types.js";

/**
 * Default cxs SQLite index path. Override with the `CXS_DB` env var or the
 * `dbPath` constructor argument.
 */
export const DEFAULT_CXS_DB_PATH =
	process.env.CXS_DB ?? path.join(os.homedir(), ".local", "state", "cxs", "index.sqlite");

interface SessionRow {
	session_uuid: string;
	file_path: string;
	title: string;
	cwd: string;
	model: string;
	started_at: string;
	ended_at: string;
	message_count: number;
	first_user_message: string | null;
}

const SESSION_COLUMNS = `
	s.session_uuid AS session_uuid,
	s.file_path    AS file_path,
	s.title        AS title,
	s.cwd          AS cwd,
	s.model        AS model,
	s.started_at   AS started_at,
	s.ended_at     AS ended_at,
	s.message_count AS message_count,
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
			kind: "message" as const,
			role: normalizeRole(r.role),
			timestamp: r.timestamp,
			title: deriveTitle(r.content_text),
			content: r.content_text,
		}));
	}

	/**
	 * Full-text search across message bodies. Uses the cxs `messages_fts`
	 * FTS5 virtual table when available; falls back to `messages.content_text
	 * LIKE` (test fixtures that omit FTS5 hit this path).
	 *
	 * Results are rolled up per session: one hit per session, with the
	 * best-ranked message's snippet and seq surfaced so the caller can
	 * optionally deep-link.
	 *
	 * `filters.cwd` / `since` / `until` are applied post-join on the session
	 * rows. `limit` bounds the final session-level result count.
	 */
	searchMessages(q: string, filters: ListSessionFilters = {}): SearchHit[] {
		const trimmed = q.trim();
		if (!trimmed) return [];
		const limit = clampLimit(filters.limit, 30, 200);

		const hits = this.hasFts5()
			? this.searchViaFts5(trimmed, filters, limit)
			: this.searchViaLike(trimmed, filters, limit);
		return hits;
	}

	private hasFts5Cache: boolean | null = null;
	private hasFts5(): boolean {
		if (this.hasFts5Cache !== null) return this.hasFts5Cache;
		const row = this.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type IN ('table','virtual') AND name = 'messages_fts' LIMIT 1`,
			)
			.get() as { name: string } | undefined;
		this.hasFts5Cache = !!row;
		return this.hasFts5Cache;
	}

	private searchViaFts5(q: string, filters: ListSessionFilters, limit: number): SearchHit[] {
		const ftsSql = `
			SELECT m.session_uuid AS session_uuid,
			       m.seq AS seq,
			       snippet(messages_fts, 0, '«', '»', '…', 12) AS snip,
			       rank AS rank
			FROM messages_fts
			JOIN messages m ON m.session_uuid = messages_fts.session_uuid AND m.seq = messages_fts.seq
			WHERE messages_fts MATCH ?
			ORDER BY rank
			LIMIT ?
		`;
		// Pull more rows than `limit` so session-level rollup after cwd / since
		// filters still has enough hits to show.
		const rawLimit = Math.min(limit * 8, 2000);
		const rows = this.db.prepare(ftsSql).all(escapeFtsQuery(q), rawLimit) as Array<{
			session_uuid: string;
			seq: number;
			snip: string;
			rank: number;
		}>;
		return this.rollupHits(rows, filters, limit);
	}

	private searchViaLike(q: string, filters: ListSessionFilters, limit: number): SearchHit[] {
		const like = `%${q}%`;
		const sql = `
			SELECT session_uuid, seq, content_text
			FROM messages
			WHERE content_text LIKE ?
			ORDER BY session_uuid, seq
			LIMIT ?
		`;
		const rawLimit = Math.min(limit * 8, 2000);
		const rows = this.db.prepare(sql).all(like, rawLimit) as Array<{
			session_uuid: string;
			seq: number;
			content_text: string;
		}>;
		return this.rollupHits(
			rows.map((r) => ({
				session_uuid: r.session_uuid,
				seq: r.seq,
				snip: makeLikeSnippet(r.content_text, q),
				rank: 0,
			})),
			filters,
			limit,
		);
	}

	private rollupHits(
		rows: Array<{ session_uuid: string; seq: number; snip: string; rank: number }>,
		filters: ListSessionFilters,
		limit: number,
	): SearchHit[] {
		// Pick best (smallest rank = best in FTS5) message per session.
		const bestBySession = new Map<string, { seq: number; snip: string; rank: number; order: number }>();
		rows.forEach((r, i) => {
			const prev = bestBySession.get(r.session_uuid);
			if (!prev || r.rank < prev.rank) {
				bestBySession.set(r.session_uuid, { seq: r.seq, snip: r.snip, rank: r.rank, order: i });
			}
		});

		if (bestBySession.size === 0) return [];

		// Fetch session rows in bulk with filter overlay.
		const uuids = [...bestBySession.keys()];
		const placeholders = uuids.map(() => "?").join(",");
		const where: string[] = [`s.session_uuid IN (${placeholders})`];
		const params: unknown[] = [...uuids];
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
		const sql = `
			SELECT ${SESSION_COLUMNS}
			FROM sessions s
			WHERE ${where.join(" AND ")}
		`;
		const sessionRows = this.db.prepare(sql).all(...params) as SessionRow[];
		const sessionsByUuid = new Map(sessionRows.map((r) => [r.session_uuid, rowToSession(r)]));

		// Assemble hits preserving the FTS5 ranking (insertion order of the
		// first occurrence per session).
		const hits: SearchHit[] = [];
		const seen = new Set<string>();
		for (const r of rows) {
			if (seen.has(r.session_uuid)) continue;
			seen.add(r.session_uuid);
			const session = sessionsByUuid.get(r.session_uuid);
			if (!session) continue; // filtered out by cwd/since/until
			const best = bestBySession.get(r.session_uuid)!;
			hits.push({ session, snippet: best.snip, bestSeq: best.seq });
			if (hits.length >= limit) break;
		}
		return hits;
	}

	analytics(): AnalyticsSummary {
		const totals = this.db
			.prepare(`SELECT COUNT(*) AS sessionCount FROM sessions`)
			.get() as { sessionCount: number };
		const projects = this.db
			.prepare(`SELECT COUNT(DISTINCT cwd) AS c FROM sessions`)
			.get() as { c: number };
		const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
		const last7d = this.db
			.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE ended_at >= ?`)
			.get(sevenDaysAgo) as { c: number };
		return {
			sessionCount: totals.sessionCount,
			projectCount: projects.c,
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
		const slugs = deriveSlugs(rows.map((r) => ({ cwd: r.cwd, sessionCount: r.sessionCount })));
		return rows.map((r) => ({
			slug: slugs[r.cwd] ?? (path.basename(r.cwd) || r.cwd),
			name: path.basename(r.cwd) || r.cwd,
			cwd: r.cwd,
			sessionCount: r.sessionCount,
			messageCount: r.messageCount,
			lastSessionAt: r.lastSessionAt,
		}));
	}

	/**
	 * Resolve a slug back to its cwd using the same derivation as listProjects().
	 * Returns undefined when the slug doesn't map to any indexed cwd.
	 */
	findProjectBySlug(slug: string): ProjectInfo | undefined {
		return this.listProjects().find((p) => p.slug === slug);
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
		startedAt: row.started_at,
		endedAt: row.ended_at,
		updatedAt: row.ended_at,
		model: row.model || undefined,
		messageCount: row.message_count,
		firstMessage: firstMsg.slice(0, 200),
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

function clampLimit(value: number | undefined, fallback: number, max: number): number {
	const v = value ?? fallback;
	if (!Number.isFinite(v) || v <= 0) return fallback;
	return Math.min(Math.floor(v), max);
}

/**
 * Wrap the query in double quotes so FTS5 treats it as a phrase. Escape any
 * embedded double quotes per FTS5 quoting rules ("" is the escape).
 */
function escapeFtsQuery(q: string): string {
	return `"${q.replace(/"/g, '""')}"`;
}

/**
 * Build a LIKE-fallback snippet: short window around the first match,
 * wrapping the match in «…» so the frontend can render consistently with
 * FTS5 output.
 */
function makeLikeSnippet(content: string, needle: string): string {
	const lower = content.toLowerCase();
	const idx = lower.indexOf(needle.toLowerCase());
	if (idx === -1) return content.slice(0, 160).trim();
	const start = Math.max(0, idx - 40);
	const end = Math.min(content.length, idx + needle.length + 80);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < content.length ? "…" : "";
	const before = content.slice(start, idx);
	const match = content.slice(idx, idx + needle.length);
	const after = content.slice(idx + needle.length, end);
	return `${prefix}${before}«${match}»${after}${suffix}`;
}
