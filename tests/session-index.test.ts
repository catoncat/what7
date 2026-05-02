import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionIndexStore, syncSessions } from "../src/sessionIndex.js";

describe("session index", () => {
  it("syncs Codex JSONL sessions, supports listing, search, and analytics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-sessions-root-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-sessions-state-"));
    const file = path.join(root, "rollout-s1.jsonl");
    await fs.writeFile(file, [
      JSON.stringify({ timestamp: "2026-05-01T00:00:00.000Z", type: "session_meta", payload: { id: "s1", cwd: "/tmp/alpha", model: "gpt-5" } }),
      JSON.stringify({ timestamp: "2026-05-01T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Find the hidden session" }] } }),
      JSON.stringify({ timestamp: "2026-05-01T00:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: "{\"cmd\":\"echo ok\"}" } }),
      JSON.stringify({ timestamp: "2026-05-01T00:00:03.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Found it." }] } }),
      JSON.stringify({ timestamp: "2026-05-01T00:00:04.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 50 } } } }),
    ].join("\n"));

    const result = await syncSessions({ dirs: [root], stateDir });
    expect(result.indexedSessions).toBe(1);
    const store = new SessionIndexStore(stateDir);
    const sessions = await store.list();
    expect(sessions[0]).toMatchObject({ id: "codex:s1", project: "alpha", messageCount: 2, toolCallCount: 1 });
    const hits = await store.search("hidden");
    expect(hits[0]?.session.id).toBe("codex:s1");
    const analytics = await store.analytics();
    expect(analytics.sessionCount).toBe(1);
    expect(analytics.tokenUsage.outputTokens).toBe(50);
    expect(analytics.tools[0]).toEqual({ tool: "exec_command", count: 1 });
  });

  it("indexes large tool outputs without storing full payloads in memory/index", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-large-root-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-large-state-"));
    const huge = "x".repeat(2_000_000);
    await fs.writeFile(path.join(root, "large.jsonl"), [
      JSON.stringify({ timestamp: "2026-05-01T01:00:00.000Z", type: "session_meta", payload: { id: "large", cwd: "/tmp/large" } }),
      JSON.stringify({ timestamp: "2026-05-01T01:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "large output repro" }] } }),
      JSON.stringify({ timestamp: "2026-05-01T01:00:02.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: huge } }),
    ].join("\n"));

    const result = await syncSessions({ dirs: [root], stateDir });
    expect(result.indexedSessions).toBe(1);
    const store = new SessionIndexStore(stateDir);
    const messages = await store.messages("codex:large");
    const toolResult = messages.find((message) => message.kind === "tool_result");
    expect(toolResult?.content.length).toBeLessThan(2_000);
    const indexRaw = await fs.readFile(path.join(stateDir, "sessions.json"), "utf8");
    expect(indexRaw.length).toBeLessThan(20_000);
  });

});
