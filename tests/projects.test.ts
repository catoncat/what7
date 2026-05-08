import { describe, expect, it } from "vitest";
import { deriveSlugs } from "../src/projects.js";

describe("deriveSlugs", () => {
	it("returns basename when names are unique", () => {
		const slugs = deriveSlugs([
			{ cwd: "/Users/alice/repo/foo", sessionCount: 10 },
			{ cwd: "/Users/alice/repo/bar", sessionCount: 5 },
		]);
		expect(slugs).toEqual({
			"/Users/alice/repo/foo": "foo",
			"/Users/alice/repo/bar": "bar",
		});
	});

	it("keeps basename for the largest sessionCount on collision, upgrades losers", () => {
		const slugs = deriveSlugs([
			{ cwd: "/Users/a/work/repos/browser-brain-loop", sessionCount: 3 },
			{ cwd: "/Users/a/snowy/browser-brain-loop", sessionCount: 50 },
		]);
		expect(slugs["/Users/a/snowy/browser-brain-loop"]).toBe("browser-brain-loop");
		expect(slugs["/Users/a/work/repos/browser-brain-loop"]).toBe("repos/browser-brain-loop");
	});

	it("upgrades multiple levels when the parent basename also collides", () => {
		const slugs = deriveSlugs([
			{ cwd: "/Users/a/work/repos/browser", sessionCount: 3 },
			{ cwd: "/Users/a/snowy/repos/browser", sessionCount: 1 },
			{ cwd: "/Users/a/play/browser", sessionCount: 50 },
		]);
		// play/browser wins the `browser` slug (highest count)
		expect(slugs["/Users/a/play/browser"]).toBe("browser");
		// work and snowy both upgrade to depth-2 and then collide again at
		// `repos/browser`; work wins (higher count), snowy escalates once more.
		expect(slugs["/Users/a/work/repos/browser"]).toBe("repos/browser");
		expect(slugs["/Users/a/snowy/repos/browser"]).toBe("snowy/repos/browser");
	});

	it("is deterministic across runs and independent of input order", () => {
		const input = [
			{ cwd: "/x/a/tool", sessionCount: 10 },
			{ cwd: "/y/b/tool", sessionCount: 20 },
		];
		const a = deriveSlugs(input);
		const b = deriveSlugs([...input].reverse());
		expect(a).toEqual(b);
		expect(a["/y/b/tool"]).toBe("tool");
		expect(a["/x/a/tool"]).toBe("a/tool");
	});

	it("handles single-level cwds (e.g. `/root`) without crashing", () => {
		const slugs = deriveSlugs([
			{ cwd: "/root", sessionCount: 1 },
			{ cwd: "", sessionCount: 1 },
		]);
		expect(slugs["/root"]).toBe("root");
		// empty cwd round-trips to itself
		expect(slugs[""]).toBe("(root)");
	});
});
