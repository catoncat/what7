import fs from "node:fs/promises";
import path from "node:path";
import { readTranscriptFile, sha256 } from "../io.js";
import { renderTranscript } from "../renderer.js";

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
	const htmlDir = path.join(params.stateDir, "html");
	await fs.mkdir(htmlDir, { recursive: true, mode: 0o700 });
	const htmlPath = path.join(htmlDir, `${safeFilename(params.sessionId)}.html`);
	await fs.writeFile(htmlPath, rendered.html, "utf8");
	return {
		title: rendered.title,
		html: rendered.html,
		htmlPath,
		sourceHash: sha256(await fs.readFile(params.sourcePath)),
	};
}

function safeFilename(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120);
}
