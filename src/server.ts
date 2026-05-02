import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export interface StaticServerHandle {
  url: string;
  close: () => Promise<void>;
  server: http.Server;
}

export async function startStaticFileServer(filePath: string, port = 0): Promise<StaticServerHandle> {
  const absolute = path.resolve(filePath);
  const server = http.createServer(async (req, res) => {
    if (req.url === "/" || req.url === `/${path.basename(absolute)}`) {
      try {
        const html = await fs.readFile(absolute);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await listen(server, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine preview server address");
  const url = `http://127.0.0.1:${address.port}/`;
  return {
    url,
    server,
    close: () => close(server),
  };
}

export function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
