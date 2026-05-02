import { describe, expect, it } from "vitest";
import worker from "../worker/src/index.js";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

function req(input: string, init?: RequestInit): WorkerRequest {
  return new Request(input, init) as unknown as WorkerRequest;
}

class MemoryKV {
  private values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe("worker publish/unpublish flow", () => {
  it("serves published HTML then returns 410 after unpublish", async () => {
    const env = { WHAT7_SHARES: new MemoryKV(), WHAT7_ADMIN_TOKEN: "admin-token" } as unknown as Env & { WHAT7_ADMIN_TOKEN: string };
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const publish = await worker.fetch(
      req("https://share.example.test/api/share", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
        body: JSON.stringify({ title: "Demo", html: "<h1>Hello</h1>", sourcePath: "fixture", sourceHash: "abc" }),
      }),
      env,
      ctx,
    );
    expect(publish.status).toBe(201);
    const published = (await publish.json()) as { id: string; url: string; deleteToken: string };

    const read = await worker.fetch(req(published.url), env, ctx);
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("<h1>Hello</h1>");

    const unpublished = await worker.fetch(
      req(`https://share.example.test/api/share/${published.id}/unpublish`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-what7-delete-token": published.deleteToken },
        body: JSON.stringify({ deleteToken: published.deleteToken }),
      }),
      env,
      ctx,
    );
    expect(unpublished.status).toBe(200);

    const reread = await worker.fetch(req(published.url), env, ctx);
    expect(reread.status).toBe(410);
    expect(await reread.text()).toContain("unpublished");
  });
});
