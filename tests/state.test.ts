import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore, toSafeRecord } from "../src/state.js";

describe("StateStore", () => {
  it("persists publish records and hides delete capability in safe output", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "what7-state-"));
    const store = new StateStore(dir);
    const record = await store.add({
      remoteId: "remote_1",
      url: "https://example.test/s/remote_1",
      sourcePath: "/tmp/session.jsonl",
      title: "Session",
      deleteCapability: "delete-secret",
      workerUrl: "https://example.test",
    });
    expect(await store.find(record.localId)).toMatchObject({ remoteId: "remote_1" });
    const updated = await store.update(record.localId, { status: "unpublished" });
    expect(updated.status).toBe("unpublished");
    const safe = toSafeRecord(updated);
    expect(safe.hasDeleteCapability).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("delete-secret");
  });
});
