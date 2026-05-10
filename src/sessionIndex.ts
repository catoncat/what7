import { spawn } from "node:child_process";
import { CxsReader, DEFAULT_CXS_DB_PATH } from "./cxsReader.js";
import { StateStore } from "./state.js";
import type { MessageRole, TimelineItem } from "./types.js";

// =============================================================================
// Types — external surface consumed by dashboard.ts, cli.ts, and tests.
// Shaped to match exactly what cxs can answer; fields that were legacy
// zero-fills for the pre-cxs backend have been dropped.
// =============================================================================

export interface ManagedSession {
	id: string;
	agent: "codex";
	title: string;
	project: string;
	sourcePath: string;
	startedAt?: string;
	endedAt?: string;
	updatedAt: string;
	model?: string;
	messageCount: number;
	firstMessage: string;
}

export interface ManagedMessage {
	id: string;
	sessionId: string;
	order: number;
	kind: TimelineItem["kind"];
	role?: MessageRole;
	timestamp?: string;
	title: string;
	content: string;
}

export interface ListSessionFilters {
	query?: string;
	cwd?: string;
	since?: string;
	until?: string;
	limit?: number;
	offset?: number;
}

/**
 * One message-level hit from full-text search, rolled up to session level.
 * `snippet` already wraps the match in `«…»` via FTS5 snippet(). `bestSeq`
 * is the message seq with the highest rank so callers can deep-link into it.
 */
export interface SearchHit {
	session: ManagedSession;
	snippet: string;
	bestSeq: number;
}

/**
 * One project = one distinct cwd in the cxs index.
 * `slug` is the URL-safe short identifier derived by `src/projects.ts`.
 */
export interface ProjectInfo {
	slug: string;
	name: string;
	cwd: string;
	sessionCount: number;
	messageCount: number;
	lastSessionAt: string | null;
}

/**
 * Bare aggregates that `what7 doctor` actually surfaces. Historically this
 * had daily/tools/agents/token rollups that no UI consumed; trimmed down.
 */
export interface AnalyticsSummary {
	sessionCount: number;
	projectCount: number;
	last7dSessionCount: number;
}

export interface SyncOptions {
	stateDir?: string;
	/** Override the cxs SQLite path. */
	dbPath?: string;
	/** Override the cxs binary (defaults to env CXS_BIN, then "cxs"). */
	cxsBin?: string;
}

export interface SyncResult {
	indexedSessions: number;
	/** Raw stdout from `cxs sync`. */
	cxsStdout?: string;
	/** Exit code from `cxs sync`. */
	cxsExitCode: number;
}

// =============================================================================
// Store — thin async facade over CxsReader. The async wrappers preserve the
// pre-existing call shape while CxsReader itself is synchronous.
// =============================================================================

export class SessionIndexStore {
	readonly dir: string;
	/** Path to the cxs SQLite index file. */
	readonly file: string;
	private readonly reader: CxsReader;

	constructor(stateDir?: string, dbPath?: string) {
		const state = new StateStore(stateDir);
		this.dir = state.dir;
		const resolvedPath = dbPath ?? DEFAULT_CXS_DB_PATH;
		this.file = resolvedPath;
		this.reader = new CxsReader(resolvedPath);
	}

	async list(filters: ListSessionFilters = {}): Promise<ManagedSession[]> {
		return this.reader.list(filters);
	}

	async searchMessages(q: string, filters: ListSessionFilters = {}): Promise<SearchHit[]> {
		return this.reader.searchMessages(q, filters);
	}

	async find(idOrPath: string): Promise<ManagedSession | undefined> {
		return this.reader.find(idOrPath);
	}

	async messages(sessionId: string): Promise<ManagedMessage[]> {
		return this.reader.messages(sessionId);
	}

	async analytics(): Promise<AnalyticsSummary> {
		return this.reader.analytics();
	}

	async listProjects(): Promise<ProjectInfo[]> {
		return this.reader.listProjects();
	}

	async findProjectBySlug(slug: string): Promise<ProjectInfo | undefined> {
		return this.reader.findProjectBySlug(slug);
	}

	close(): void {
		this.reader.close();
	}
}

// =============================================================================
// syncSessions — delegate to the `cxs sync` CLI. cxs owns indexing.
// =============================================================================

export async function syncSessions(options: SyncOptions = {}): Promise<SyncResult> {
	const cxsBin = options.cxsBin ?? process.env.CXS_BIN ?? "cxs";
	const args = ["sync"];
	if (options.dbPath) args.push("--db", options.dbPath);
	return new Promise<SyncResult>((resolve) => {
		let stdout = "";
		let stderr = "";
		let child;
		try {
			child = spawn(cxsBin, args, { stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			resolve({
				indexedSessions: 0,
				cxsStdout: error instanceof Error ? error.message : String(error),
				cxsExitCode: -1,
			});
			return;
		}
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			resolve({ indexedSessions: 0, cxsStdout: error.message, cxsExitCode: -1 });
		});
		child.on("close", (code) => {
			const indexed = parseIndexedCount(stdout) ?? parseIndexedCount(stderr);
			resolve({
				indexedSessions: indexed ?? 0,
				cxsStdout: stdout || stderr,
				cxsExitCode: code ?? -1,
			});
		});
	});
}

function parseIndexedCount(text: string): number | undefined {
	const match = text.match(/(\d+)\s+sessions?/i);
	if (!match || !match[1]) return undefined;
	const n = Number(match[1]);
	return Number.isFinite(n) ? n : undefined;
}
