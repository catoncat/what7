import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state.js";

async function freshStore() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-shortcuts-"));
	return { dir, store: new StateStore(dir) };
}

describe("StateStore shortcuts", () => {
	it("addShortcut auto-increments position and listShortcuts sorts ascending", async () => {
		const { store } = await freshStore();
		const a = await store.addShortcut({ label: "Foo", url: "/api/v1/projects" });
		const b = await store.addShortcut({ label: "Bar", url: "https://example.test" });
		const c = await store.addShortcut({ label: "Baz", url: "/x", position: 0 });
		expect(a.position).toBe(0);
		expect(b.position).toBe(1);
		expect(c.position).toBe(0);
		const listed = await store.listShortcuts();
		// Stable sort by position ascending: c(0) and a(0) both at 0, then b(1).
		expect(listed.map((s) => s.label).slice(-1)).toEqual(["Bar"]);
		expect(listed.find((s) => s.label === "Bar")?.position).toBe(1);
	});

	it("addShortcut accepts optional icon and persists round-trip", async () => {
		const { dir, store } = await freshStore();
		const sc = await store.addShortcut({ label: "With icon", url: "/x", icon: "🚀" });
		expect(sc.icon).toBe("🚀");
		const raw = await fs.readFile(path.join(dir, "state.json"), "utf8");
		expect(raw).toContain("🚀");
		const reloaded = await new StateStore(dir).listShortcuts();
		expect(reloaded[0]?.icon).toBe("🚀");
	});

	it("updateShortcut patches fields and bumps updatedAt", async () => {
		const { store } = await freshStore();
		const sc = await store.addShortcut({ label: "old", url: "/old" });
		await new Promise((r) => setTimeout(r, 5));
		const next = await store.updateShortcut(sc.id, { label: "new", position: 9 });
		expect(next.label).toBe("new");
		expect(next.position).toBe(9);
		expect(next.url).toBe("/old");
		expect(next.updatedAt > sc.updatedAt).toBe(true);
	});

	it("updateShortcut throws when id is unknown", async () => {
		const { store } = await freshStore();
		await expect(store.updateShortcut("sc_missing", { label: "x" })).rejects.toThrow(
			/No shortcut found/,
		);
	});

	it("deleteShortcut removes by id and returns false for unknown ids", async () => {
		const { store } = await freshStore();
		const sc = await store.addShortcut({ label: "gone", url: "/gone" });
		expect(await store.deleteShortcut(sc.id)).toBe(true);
		expect(await store.listShortcuts()).toEqual([]);
		expect(await store.deleteShortcut("sc_missing")).toBe(false);
	});

	it("load() rejects state files missing the shortcuts field", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-shortcuts-strict-"));
		const file = path.join(dir, "state.json");
		await fs.writeFile(file, JSON.stringify({ version: 1, records: [] }));
		const store = new StateStore(dir);
		await expect(store.load()).rejects.toThrow(/Unsupported state file/);
	});

	it("load() returns empty state when state.json does not exist", async () => {
		const { store } = await freshStore();
		const loaded = await store.load();
		expect(loaded).toEqual({ version: 1, records: [], shortcuts: [], projects: [] });
	});
});
