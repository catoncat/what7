import { spawn } from "node:child_process";
import { CxsReader, DEFAULT_CXS_DB_PATH } from "./cxsReader.js";
import { StateStore } from "./state.js";
import type { MessageRole, TimelineItem } from "./types.js";

// =============================================================================
// Types — preserved external surface (consumed by dashboard.ts, cli.ts,
// humanWorkflow.ts, and tests).
// =============================================================================

export interface TokenUsageSummary {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	reasoningOutputTokens: number;
	totalTokens: number;
	estimatedCostUsd: number | null;
}

export interface ManagedSession {
	id: string;
	agent: "codex";
	title: string;
	project: string;
	sourcePath: string;
	sourceSize: number;
	sourceMtimeMs: number;
	startedAt?: string;
	endedAt?: string;
	updatedAt: string;
	model?: string;
	lineCount: number;
	messageCount: number;
	userMessageCount: number;
	assistantMessageCount: number;
	/** Always 0 under cxs backend (cxs squashes events into role=assistant). */
	toolCallCount: number;
	/** Always 0 under cxs backend. */
	toolResultCount: number;
	/** Always 0 under cxs backend. */
	reasoningCount: number;
	firstMessage: string;
	/** Always zero usage under cxs backend (token usage isn't indexed). */
	tokenUsage: TokenUsageSummary;
	/** Always {} under cxs backend (per-tool counts aren't indexed). */
	toolUsage: Record<string, number>;
}

export interface ManagedMessage {
	id: string;
	sessionId: string;
	order: number;
	line: number;
	kind: TimelineItem["kind"];
	role?: MessageRole;
	timestamp?: string;
	title: string;
	content: string;
	toolName?: string;
	callId?: string;
}

export interface ListSessionFilters {
	query?: string;
	project?: string;
	agent?: string;
	since?: string;
	until?: string;
	limit?: number;
	offset?: number;
}

export interface SearchHit {
	session: ManagedSession;
	message: ManagedMessage;
	snippet: string;
}

export interface AnalyticsSummary {
	sessionCount: number;
	messageCount: number;
	userMessageCount: number;
	assistantMessageCount: number;
	toolCallCount: number;
	toolResultCount: number;
	totalDurationMs: number;
	tokenUsage: TokenUsageSummary;
	projects: Array<{ project: string; sessionCount: number; messageCount: number }>;
	agents: Array<{ agent: string; sessionCount: number }>;
	tools: Array<{ tool: string; count: number }>;
	daily: Array<{ date: string; sessions: number; messages: number; outputTokens: number }>;
	/** M1 addition: distinct cwd projects in the cxs index. */
	projectCount?: number;
	/** M1 addition: sessions whose ended_at is within the last 7 days. */
	last7dSessionCount?: number;
}

export interface SyncOptions {
	stateDir?: string;
	/** No-op under the cxs backend; cxs decides its own roots. Kept for surface compat. */
	dirs?: string[];
	/** No-op under the cxs backend. Kept for surface compat. */
	maxFiles?: number;
	/** Override the cxs SQLite path. */
	dbPath?: string;
	/** Override the cxs binary (defaults to env CXS_BIN, then "cxs"). */
	cxsBin?: string;
}

export interface SyncResult {
	roots: string[];
	scannedFiles: number;
	indexedSessions: number;
	skippedFiles: Array<{ path: string; error: string }>;
	/** Raw stdout from `cxs sync`. */
	cxsStdout?: string;
	/** Exit code from `cxs sync`. */
	cxsExitCode?: number;
}

// =============================================================================
// Store — thin facade over CxsReader (read-only). Async wrappers preserve the
// pre-existing call shape while CxsReader is synchronous internally.
// =============================================================================

export class SessionIndexStore {
	readonly dir: string;
	/** Path to the cxs SQLite index file (was previously a what7-owned JSON file). */
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

	async find(idOrPath: string): Promise<ManagedSession | undefined> {
		return this.reader.find(idOrPath);
	}

	async messages(sessionId: string): Promise<ManagedMessage[]> {
		return this.reader.messages(sessionId);
	}

	async search(query: string, filters: ListSessionFilters = {}): Promise<SearchHit[]> {
		return this.reader.search(query, filters);
	}

	/** `_filters` accepted for CLI-surface compat but currently ignored. */
	async analytics(_filters?: ListSessionFilters): Promise<AnalyticsSummary> {
		return this.reader.analytics();
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
				roots: [],
				scannedFiles: 0,
				indexedSessions: 0,
				skippedFiles: [{ path: cxsBin, error: error instanceof Error ? error.message : String(error) }],
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
			resolve({
				roots: [],
				scannedFiles: 0,
				indexedSessions: 0,
				skippedFiles: [{ path: cxsBin, error: error.message }],
				cxsExitCode: -1,
			});
		});
		child.on("close", (code) => {
			const indexed = parseIndexedCount(stdout) ?? parseIndexedCount(stderr);
			resolve({
				roots: [],
				scannedFiles: 0,
				indexedSessions: indexed ?? 0,
				skippedFiles: [],
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

// =============================================================================
// Legacy helpers — kept as no-ops only for downstream surface compat.
// =============================================================================

export function defaultSessionRoots(): string[] {
	return [];
}
