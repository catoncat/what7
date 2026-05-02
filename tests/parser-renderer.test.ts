import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseCodexJsonl } from "../src/parser.js";
import { renderTranscript } from "../src/renderer.js";

const fixture = fs.readFileSync("fixtures/sample.jsonl", "utf8");

describe("parser + renderer", () => {
  it("normalizes Codex JSONL timeline items", () => {
    const transcript = parseCodexJsonl(fixture, "fixtures/sample.jsonl");
    expect(transcript.sessionId).toBe("sample-session-001");
    expect(transcript.stats.messageCount).toBe(2);
    expect(transcript.stats.toolCallCount).toBe(1);
    expect(transcript.stats.toolResultCount).toBe(1);
    expect(transcript.stats.reasoningCount).toBe(1);
    expect(transcript.items.map((item) => item.kind)).toContain("metadata");
  });

  it("renders standalone HTML with folded tool output and safe markdown", () => {
    const transcript = parseCodexJsonl(fixture, "fixtures/sample.jsonl");
    const result = renderTranscript(transcript, { generatedAt: "2026-05-01T00:00:00.000Z" });
    expect(result.html).toContain("<!doctype html>");
    expect(result.html).toContain("agentsview-style transcript");
    expect(result.html).toContain("Search transcript");
    expect(result.html).toContain("Newest first");
    expect(result.html).toContain("Keyboard shortcuts");
    expect(result.html).toContain("kind-tool tool-card");
    expect(result.html).toContain("<details");
    expect(result.html).toContain("export const ok = true;");
    expect(result.html).not.toContain("<script>alert(1)</script>");
  });

  it("redacts common secret shapes by default", () => {
    const bearer = "abcdefghijklmnopqrstuvwxyz" + "123456";
    const apiKey = "sk-" + "abcdefghijklmnopqrstuvwxyz";
    const transcript = parseCodexJsonl(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: `Authorization: Bearer ${bearer} API_KEY=${apiKey}` }],
        },
      }),
      "secret.jsonl",
    );
    const result = renderTranscript(transcript);
    expect(result.html).toContain("Authorization: Bearer [REDACTED]");
    expect(result.html).toContain("API_KEY=[REDACTED]");
    expect(result.html).not.toContain(bearer);
    expect(result.redactionCount).toBeGreaterThan(0);
  });
});
