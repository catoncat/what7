import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionIndexStore, syncSessions } from "../src/sessionIndex.js";
import { findHumanSessions, recentHumanSessions, resolveHumanSessionTarget } from "../src/humanWorkflow.js";

async function writeSession(root: string, id: string, cwd: string, timestamp: string, userText: string, assistantText = "ok"): Promise<string> {
  const file = path.join(root, `${id}.jsonl`);
  await fs.writeFile(file, [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id, cwd, model: "gpt-5" } }),
    JSON.stringify({ timestamp, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: userText }] } }),
    JSON.stringify({ timestamp, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: assistantText }] } }),
  ].join("\n"));
  return file;
}

describe("human workflow helpers", () => {
  it("prefers the current cwd project for recent sessions but falls back globally", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-human-root-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-human-state-"));
    await writeSession(root, "current-old", "/tmp/current-project", "2026-05-01T00:00:00.000Z", "old current project");
    await writeSession(root, "other-new", "/tmp/other-project", "2026-05-01T00:05:00.000Z", "new unrelated project");
    await syncSessions({ dirs: [root], stateDir });

    const store = new SessionIndexStore(stateDir);
    const scoped = await recentHumanSessions(store, { cwd: "/tmp/current-project", limit: 5 });
    expect(scoped.scope.project).toBe("current-project");
    expect(scoped.scope.fallback).toBe(false);
    expect(scoped.sessions.map((session) => session.id)).toEqual(["codex:current-old"]);

    const fallback = await recentHumanSessions(store, { cwd: "/tmp/missing-project", limit: 5 });
    expect(fallback.scope.fallback).toBe(true);
    expect(fallback.sessions[0]?.id).toBe("codex:other-new");
  });

  it("resolves ids, paths, omitted args, and query text into shareable session targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-human-target-root-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-human-target-state-"));
    const file = await writeSession(root, "share-me", "/tmp/what7", "2026-05-01T00:00:00.000Z", "the memorable phrase", "ready to share");
    await syncSessions({ dirs: [root], stateDir });

    const store = new SessionIndexStore(stateDir);
    await expect(resolveHumanSessionTarget(store, undefined, { cwd: "/tmp/what7" })).resolves.toMatchObject({
      session: { id: "codex:share-me" },
      inputPath: file,
      reason: "recent",
    });
    await expect(resolveHumanSessionTarget(store, "codex:share-me", { cwd: "/tmp/other" })).resolves.toMatchObject({
      session: { id: "codex:share-me" },
      inputPath: file,
      reason: "id",
    });
    await expect(resolveHumanSessionTarget(store, file, { cwd: "/tmp/other" })).resolves.toMatchObject({
      inputPath: file,
      reason: "path",
    });
    await expect(resolveHumanSessionTarget(store, "memorable phrase", { cwd: "/tmp/what7" })).resolves.toMatchObject({
      session: { id: "codex:share-me" },
      inputPath: file,
      reason: "search",
    });
  });

  it("prefers current-project full-text hits before broader matches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-human-find-root-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-human-find-state-"));
    await writeSession(root, "current-hit", "/tmp/what7", "2026-05-01T00:00:00.000Z", "same keyword in current project");
    await writeSession(root, "other-hit", "/tmp/other", "2026-05-01T00:05:00.000Z", "same keyword outside");
    await syncSessions({ dirs: [root], stateDir });

    const result = await findHumanSessions(new SessionIndexStore(stateDir), "keyword", { cwd: "/tmp/what7", limit: 10 });
    expect(result.scope.project).toBe("what7");
    expect(result.scope.fallback).toBe(false);
    expect(result.hits.map((hit) => hit.session.id)).toEqual(["codex:current-hit"]);
  });
});
