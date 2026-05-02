import { describe, expect, it } from "vitest";
import http from "node:http";
import { PublishClient } from "../src/publishClient.js";
import { listen, close } from "../src/server.js";

describe("PublishClient", () => {
  it("publishes and unpublishes against the Worker API shape", async () => {
    const requests: string[] = [];
    const server = http.createServer(async (req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === "/api/share") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "remote_1", url: "http://127.0.0.1/s/remote_1", deleteToken: "cap", status: "published" }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/share/remote_1/unpublish") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "remote_1", status: "unpublished", url: "http://127.0.0.1/s/remote_1" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await listen(server, 0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("bad address");
    const client = new PublishClient({ workerUrl: `http://127.0.0.1:${address.port}`, adminToken: "admin" });
    const published = await client.publish({ title: "t", html: "<h1>t</h1>", sourcePath: "x", sourceHash: "hash" });
    expect(published.url).toContain("remote_1");
    const unpublished = await client.unpublish(published.id, published.deleteToken);
    expect(unpublished.status).toBe("unpublished");
    expect(requests).toEqual(["POST /api/share", "POST /api/share/remote_1/unpublish"]);
    await close(server);
  });
});
