import fs from "node:fs/promises";
import path from "node:path";
import { readTranscriptFile, sha256 } from "../io.js";
import { renderTranscript } from "../renderer.js";
import type { ManagedMessage, ManagedSession } from "../sessionIndex.js";
import type { TimelineItem, Transcript } from "../types.js";

/**
 * Render a cxs-indexed session's JSONL file to standalone share HTML and
 * cache it under <stateDir>/html/<safe-id>.html. Returns everything the
 * PublishClient needs plus the hash of the raw source (for worker-side
 * de-dup).
 *
 * This used to live inline in dashboard.ts publishIndexedSession. Pulling it
 * out lets CLI / future transcript endpoints share the same rendering
 * pipeline without reaching into the HTTP layer.
 */
export interface BuiltTranscript {
	title: string;
	html: string;
	htmlPath: string;
	sourceHash: string;
}

export async function buildTranscriptForShare(params: {
	sourcePath: string;
	sessionId: string;
	stateDir: string;
}): Promise<BuiltTranscript> {
	const transcript = await readTranscriptFile(params.sourcePath);
	const rendered = renderTranscript(transcript, { sourcePath: params.sourcePath });
	return writeRenderedTranscript({
		stateDir: params.stateDir,
		htmlId: params.sessionId,
		rendered,
		sourceHash: sha256(await fs.readFile(params.sourcePath)),
	});
}

export interface SelectedShareMessage {
	id?: string;
	order?: number;
	content?: string;
}

export async function buildSelectedTranscriptForShare(params: {
	session: ManagedSession;
	messages: ManagedMessage[];
	selection: SelectedShareMessage[];
	stateDir: string;
}): Promise<BuiltTranscript> {
	const selected = selectMessages(params.messages, params.selection);
	const sourceHash = sha256(
		JSON.stringify({
			sourcePath: params.session.sourcePath,
			sessionId: params.session.id,
			selection: selected.map((m) => ({ order: m.order, content: m.content })),
		}),
	);
	const transcript = selectedTranscript(params.session, selected);
	const rendered = renderTranscript(transcript, {
		sourcePath: params.session.sourcePath,
		title: `${params.session.title || "Codex session"} · selected`,
	});
	return writeRenderedTranscript({
		stateDir: params.stateDir,
		htmlId: `${params.session.id}-selected-${sourceHash.slice(0, 12)}`,
		rendered,
		sourceHash,
	});
}

function selectMessages(
	messages: ManagedMessage[],
	selection: SelectedShareMessage[],
): ManagedMessage[] {
	const byId = new Map(messages.map((m) => [m.id, m]));
	const byOrder = new Map(messages.map((m) => [m.order, m]));
	const selected: ManagedMessage[] = [];
	for (const item of selection) {
		const source = item.id ? byId.get(item.id) : item.order !== undefined ? byOrder.get(item.order) : undefined;
		if (!source) {
			throw new Error(`selected message not found: ${item.id ?? item.order ?? "<missing>"}`);
		}
		selected.push({
			...source,
			content: item.content ?? source.content,
			title: item.content !== undefined ? deriveTitle(item.content) : source.title,
		});
	}
	return [...selected].sort((a, b) => a.order - b.order);
}

function selectedTranscript(session: ManagedSession, messages: ManagedMessage[]): Transcript {
	const items: TimelineItem[] = messages.map((m, index) => ({
		id: `selected-${session.id}-${m.order}`,
		line: m.order + 1,
		order: index,
		timestamp: m.timestamp,
		kind: "message",
		role: m.role,
		title: m.title,
		content: m.content,
		rawType: "what7_selected_message",
	}));
	return {
		sourcePath: session.sourcePath,
		title: session.title || "Codex session",
		sessionId: session.id,
		startedAt: messages[0]?.timestamp ?? session.startedAt,
		endedAt: messages[messages.length - 1]?.timestamp ?? session.endedAt,
		metadata: {
			model: session.model,
			project: session.project,
			what7ShareMode: "selected_messages",
			selectedMessageCount: messages.length,
		},
		items,
		stats: {
			lineCount: messages.length,
			itemCount: messages.length,
			messageCount: messages.length,
			toolCallCount: 0,
			toolResultCount: 0,
			reasoningCount: 0,
		},
	};
}

function deriveTitle(content: string): string {
	return content.trim().split(/\r?\n/, 1)[0]?.slice(0, 80) || "Selected message";
}

async function writeRenderedTranscript(params: {
	stateDir: string;
	htmlId: string;
	rendered: ReturnType<typeof renderTranscript>;
	sourceHash: string;
}): Promise<BuiltTranscript> {
	const htmlDir = path.join(params.stateDir, "html");
	await fs.mkdir(htmlDir, { recursive: true, mode: 0o700 });
	const htmlPath = path.join(htmlDir, `${safeFilename(params.htmlId)}.html`);
	await fs.writeFile(htmlPath, params.rendered.html, "utf8");
	return {
		title: params.rendered.title,
		html: params.rendered.html,
		htmlPath,
		sourceHash: params.sourceHash,
	};
}

function safeFilename(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120);
}
