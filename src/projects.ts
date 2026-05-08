import path from "node:path";

/**
 * Input row for slug derivation. `sessionCount` decides who keeps the short
 * name when two cwds collide: higher count wins basename, others get upgraded.
 */
export interface SlugInput {
	cwd: string;
	sessionCount: number;
}

/**
 * Derive a URL-safe slug for each cwd using the PRD §6.1 D-02 rule:
 *
 *   1. Start with basename(cwd).
 *   2. Group by current slug. If a group has >1 cwd, the entry with the
 *      highest sessionCount keeps the short form; the rest get prefixed with
 *      one more parent segment (`parent/basename`).
 *   3. Repeat until every slug is unique or no more parents remain.
 *
 * Returns a map `cwd -> slug`. Deterministic given the same input set.
 *
 * Slug characters: path segments are joined with `/`; the frontend treats the
 * whole thing as one URL segment so it must be passed through
 * `encodeURIComponent` when building a path.
 */
export function deriveSlugs(inputs: SlugInput[]): Record<string, string> {
	// Working state: for each cwd remember how many tail segments we are currently using.
	const parts = new Map<string, string[]>();
	const depth = new Map<string, number>();
	for (const { cwd } of inputs) {
		const segs = splitPath(cwd);
		parts.set(cwd, segs);
		depth.set(cwd, segs.length ? 1 : 0);
	}

	// Stable order by sessionCount DESC so the first writer per slug is the
	// largest group and the upgrade loop bumps the smaller ones.
	const ordered = [...inputs].sort((a, b) => b.sessionCount - a.sessionCount);

	for (let guard = 0; guard < 8; guard++) {
		const out = new Map<string, string>();
		const byCurrent = new Map<string, string[]>();
		for (const { cwd } of ordered) {
			const slug = currentSlug(cwd, parts, depth);
			out.set(cwd, slug);
			const bucket = byCurrent.get(slug);
			if (bucket) bucket.push(cwd);
			else byCurrent.set(slug, [cwd]);
		}
		let upgraded = false;
		for (const [, group] of byCurrent) {
			if (group.length <= 1) continue;
			// keep ordered[0] (largest sessionCount), upgrade the rest
			for (let i = 1; i < group.length; i++) {
				const cwd = group[i]!;
				const segs = parts.get(cwd) ?? [];
				const cur = depth.get(cwd) ?? 1;
				if (cur < segs.length) {
					depth.set(cwd, cur + 1);
					upgraded = true;
				}
			}
		}
		if (!upgraded) return Object.fromEntries(out);
	}

	// Fall-through: give up and return whatever we have.
	const final = new Map<string, string>();
	for (const { cwd } of inputs) final.set(cwd, currentSlug(cwd, parts, depth));
	return Object.fromEntries(final);
}

function currentSlug(cwd: string, parts: Map<string, string[]>, depth: Map<string, number>): string {
	const segs = parts.get(cwd) ?? [];
	if (!segs.length) return cwd || "(root)";
	const n = Math.max(1, Math.min(depth.get(cwd) ?? 1, segs.length));
	return segs.slice(segs.length - n).join("/");
}

function splitPath(cwd: string): string[] {
	if (!cwd) return [];
	const normalized = path.normalize(cwd).replace(/\/+$/, "");
	if (normalized === "." || normalized === "/") return [];
	return normalized.split(path.sep).filter((s) => s && s !== ".");
}
