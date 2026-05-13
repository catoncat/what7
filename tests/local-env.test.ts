import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLocalDeployEnv } from "../src/localEnv.js";

describe("loadLocalDeployEnv", () => {
  it("loads supported Worker env from .what7/deploy.env", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-local-env-"));
    await fs.mkdir(path.join(root, ".what7"));
    await fs.writeFile(
      path.join(root, ".what7", "deploy.env"),
      [
        "# local-only secrets",
        "WHAT7_WORKER_URL=http://127.0.0.1:8787",
        "export WHAT7_ADMIN_TOKEN='secret-token'",
        "UNRELATED=value",
      ].join("\n"),
    );

    const env: NodeJS.ProcessEnv = {};
    const result = await loadLocalDeployEnv({ rootDir: root, env });

    expect(result.found).toBe(true);
    expect(result.loaded).toEqual(["WHAT7_WORKER_URL", "WHAT7_ADMIN_TOKEN"]);
    expect(result.ignored).toEqual(["UNRELATED"]);
    expect(env.WHAT7_WORKER_URL).toBe("http://127.0.0.1:8787");
    expect(env.WHAT7_ADMIN_TOKEN).toBe("secret-token");
    expect(env.UNRELATED).toBeUndefined();
  });

  it("does not override explicit process env values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-local-env-existing-"));
    await fs.mkdir(path.join(root, ".what7"));
    await fs.writeFile(
      path.join(root, ".what7", "deploy.env"),
      "WHAT7_WORKER_URL=http://from-file.example\nWHAT7_ADMIN_TOKEN=from-file\n",
    );

    const env: NodeJS.ProcessEnv = { WHAT7_WORKER_URL: "http://explicit.example" };
    const result = await loadLocalDeployEnv({ rootDir: root, env });

    expect(result.loaded).toEqual(["WHAT7_ADMIN_TOKEN"]);
    expect(result.skippedExisting).toEqual(["WHAT7_WORKER_URL"]);
    expect(env.WHAT7_WORKER_URL).toBe("http://explicit.example");
    expect(env.WHAT7_ADMIN_TOKEN).toBe("from-file");
  });

  it("treats a missing local deploy env as non-fatal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "what7-local-env-missing-"));
    const env: NodeJS.ProcessEnv = {};

    const result = await loadLocalDeployEnv({ rootDir: root, env });

    expect(result.found).toBe(false);
    expect(result.loaded).toEqual([]);
    expect(env.WHAT7_WORKER_URL).toBeUndefined();
  });
});
