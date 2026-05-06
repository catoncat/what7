#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { Command } from "commander";
import { renderFile } from "./io.js";
import { PublishClient } from "./publishClient.js";
import { startStaticFileServer, openBrowser } from "./server.js";
import { startDashboard } from "./dashboard.js";
import { StateStore, toSafeRecord } from "./state.js";
import { SessionIndexStore, syncSessions } from "./sessionIndex.js";
import {
  findHumanSessions,
  formatSearchRows,
  formatSessionPreview,
  formatSessionRows,
  recentHumanSessions,
  resolveHumanSessionTarget,
} from "./humanWorkflow.js";

interface GlobalOptions {
  stateDir?: string;
  json?: boolean;
}

const program = new Command();

program
  .name("what7")
  .description("Render Codex session JSONL to readable HTML and optionally publish it with a Cloudflare Worker.")
  .version("0.1.0")
  .option("--state-dir <dir>", "override local state directory")
  .option("--json", "emit stable JSON output");


program
  .command("recent")
  .option("--project <project>", "prefer/filter this project; defaults to current cwd basename")
  .option("--all-projects", "do not prefer the current cwd project")
  .option("--since <date>", "include sessions after this date")
  .option("--until <date>", "include sessions before this date")
  .option("--limit <n>", "maximum rows", parsePositiveInt)
  .option("--json", "emit stable JSON output")
  .description("Show recent Codex sessions, preferring the current project.")
  .action(async (options: { project?: string; allProjects?: boolean; since?: string; until?: string; limit?: number; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const result = await recentHumanSessions(new SessionIndexStore(globals.stateDir), {
        cwd: process.cwd(),
        project: options.project,
        allProjects: options.allProjects,
        since: options.since,
        until: options.until,
        limit: options.limit,
      });
      output(options.json || globals.json, result, formatSessionRows(result.sessions, result.scope));
    });
  });

program
  .command("find")
  .argument("<query>", "text to find in indexed sessions")
  .option("--project <project>", "prefer/filter this project; defaults to current cwd basename")
  .option("--all-projects", "do not prefer the current cwd project")
  .option("--since <date>", "include sessions after this date")
  .option("--until <date>", "include sessions before this date")
  .option("--limit <n>", "maximum hits", parsePositiveInt)
  .option("--json", "emit stable JSON output")
  .description("Find relevant sessions by phrase, preferring the current project.")
  .action(async (query: string, options: { project?: string; allProjects?: boolean; since?: string; until?: string; limit?: number; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const result = await findHumanSessions(new SessionIndexStore(globals.stateDir), query, {
        cwd: process.cwd(),
        project: options.project,
        allProjects: options.allProjects,
        since: options.since,
        until: options.until,
        limit: options.limit,
      });
      output(options.json || globals.json, result, formatSearchRows(result.hits, result.scope));
    });
  });

program
  .command("view")
  .argument("[session-or-query]", "session id, JSONL path, or phrase; omitted means recent current-project session")
  .option("--project <project>", "prefer/filter this project; defaults to current cwd basename")
  .option("--all-projects", "do not prefer the current cwd project")
  .option("--tools", "include tool calls/results in terminal preview")
  .option("--context", "include reasoning/context in terminal preview")
  .option("--json", "emit stable JSON output")
  .description("Preview a clean terminal transcript for a session.")
  .action(async (target: string | undefined, options: { project?: string; allProjects?: boolean; tools?: boolean; context?: boolean; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new SessionIndexStore(globals.stateDir);
      const resolved = await resolveHumanSessionTarget(store, target, {
        cwd: process.cwd(),
        project: options.project,
        allProjects: options.allProjects,
      });
      if (!resolved.session) {
        output(options.json || globals.json, resolved, `Resolved ${resolved.inputPath}\nRun: what7 render ${resolved.inputPath}`);
        return;
      }
      const messages = await store.messages(resolved.session.id);
      output(options.json || globals.json, { ...resolved, messages }, formatSessionPreview(resolved.session, messages, { includeTools: options.tools, includeContext: options.context }));
    });
  });

program
  .command("share")
  .argument("[session-or-query]", "session id, JSONL path, or phrase; omitted means recent current-project session")
  .option("-o, --output <file>", "also write rendered HTML to this path")
  .option("--title <title>", "override page title")
  .option("--project <project>", "prefer/filter this project; defaults to current cwd basename")
  .option("--all-projects", "do not prefer the current cwd project")
  .option("--worker-url <url>", "Cloudflare Worker base URL; defaults to WHAT7_WORKER_URL")
  .option("--admin-token <token>", "Worker admin token; defaults to WHAT7_ADMIN_TOKEN")
  .option("--debug-url", "also print a debug URL with ?tools=1&context=1")
  .option("--no-redact", "disable default secret redaction")
  .option("--json", "emit stable JSON output")
  .description("Find, render, and publish a session in one human-friendly command.")
  .action(async (target: string | undefined, options: { output?: string; title?: string; project?: string; allProjects?: boolean; workerUrl?: string; adminToken?: string; debugUrl?: boolean; redact?: boolean; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new SessionIndexStore(globals.stateDir);
      const resolved = await resolveHumanSessionTarget(store, target, {
        cwd: process.cwd(),
        project: options.project,
        allProjects: options.allProjects,
      });
      const workerUrl = options.workerUrl ?? process.env.WHAT7_WORKER_URL;
      const adminToken = options.adminToken ?? process.env.WHAT7_ADMIN_TOKEN;
      if (!workerUrl) throw new Error("Missing Worker URL. Set WHAT7_WORKER_URL or pass --worker-url.");
      const rendered = await renderFile(resolved.inputPath, {
        outputPath: options.output,
        title: options.title,
        redact: options.redact,
      });
      const published = await new PublishClient({ workerUrl, adminToken }).publish({
        title: rendered.title,
        html: rendered.html,
        sourcePath: path.resolve(resolved.inputPath),
        sourceHash: rendered.sourceHash,
      });
      const record = await new StateStore(globals.stateDir).add({
        remoteId: published.id,
        url: published.url,
        sourcePath: path.resolve(resolved.inputPath),
        title: rendered.title,
        deleteCapability: published.deleteToken,
        workerUrl,
        htmlPath: rendered.outputPath,
      });
      const debugUrl = `${published.url}?tools=1&context=1`;
      const payload = {
        record: toSafeRecord(record),
        url: published.url,
        ...(options.debugUrl ? { debug_url: debugUrl } : {}),
        local_id: record.localId,
        remote_id: record.remoteId,
        session_id: resolved.session?.id,
        resolved_from: resolved.reason,
      };
      output(options.json || globals.json, payload, `Published ${published.url}\nLocal record ${record.localId}${options.debugUrl ? `\nDebug ${debugUrl}` : ""}`);
    });
  });

program
  .command("sync")
  .option("--dir <dir>", "session root to scan; can be repeated", collect, [] as string[])
  .option("--max-files <n>", "maximum JSONL files to scan", parsePositiveInt)
  .option("--json", "emit stable JSON output")
  .description("Discover Codex sessions and sync them into the local session index.")
  .action(async (options: { dir: string[]; maxFiles?: number; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const result = await syncSessions({ stateDir: globals.stateDir, dirs: options.dir, maxFiles: options.maxFiles });
      output(options.json || globals.json, {
        roots: result.roots,
        scanned_files: result.scannedFiles,
        indexed_sessions: result.indexedSessions,
        skipped_files: result.skippedFiles,
        index_file: new SessionIndexStore(globals.stateDir).file,
      }, `Synced ${result.indexedSessions}/${result.scannedFiles} sessions into ${new SessionIndexStore(globals.stateDir).file}`);
    });
  });

program
  .command("sessions")
  .alias("ls")
  .option("--query <text>", "filter by title, project, path, model, or first message")
  .option("--project <project>", "filter by project")
  .option("--since <date>", "include sessions after this date")
  .option("--until <date>", "include sessions before this date")
  .option("--limit <n>", "maximum rows", parsePositiveInt)
  .option("--json", "emit stable JSON output")
  .description("List indexed sessions. Run `what7 sync` first.")
  .action(async (options: { query?: string; project?: string; since?: string; until?: string; limit?: number; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new SessionIndexStore(globals.stateDir);
      const sessions = await store.list(options);
      output(options.json || globals.json, { sessions }, sessions.length ? sessions.map((s) => `${s.id}\t${s.project}\t${s.messageCount} msgs\t${s.title}`).join("\n") : "No indexed sessions. Run `what7 sync`.");
    });
  });

program
  .command("session")
  .argument("<id-or-path>", "session id or source JSONL path")
  .option("--json", "emit stable JSON output")
  .description("Show indexed session metadata and messages.")
  .action(async (idOrPath: string, options: { json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new SessionIndexStore(globals.stateDir);
      const session = await store.find(idOrPath);
      if (!session) throw new Error(`No indexed session found for ${idOrPath}. Run what7 sync or pass a JSONL path to render/share.`);
      const messages = await store.messages(session.id);
      output(options.json || globals.json, { session, messages }, `${session.id}\n${session.title}\n${session.sourcePath}\n${messages.length} timeline items`);
    });
  });

program
  .command("search")
  .argument("<query>", "full-text query over indexed messages")
  .option("--project <project>", "filter by project")
  .option("--limit <n>", "maximum hits", parsePositiveInt)
  .option("--json", "emit stable JSON output")
  .description("Search indexed session messages.")
  .action(async (query: string, options: { project?: string; limit?: number; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const hits = await new SessionIndexStore(globals.stateDir).search(query, options);
      output(options.json || globals.json, { hits }, hits.length ? hits.map((hit) => `${hit.session.id}\tline ${hit.message.line}\t${hit.snippet.replace(/\s+/g, " ")}`).join("\n") : "No matches.");
    });
  });

program
  .command("usage")
  .option("--json", "emit stable JSON output")
  .option("--project <project>", "filter by project")
  .option("--since <date>", "include sessions after this date")
  .option("--until <date>", "include sessions before this date")
  .description("Print indexed token usage summary and daily buckets.")
  .action(async (options: { project?: string; since?: string; until?: string; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const summary = await new SessionIndexStore(globals.stateDir).analytics(options);
      output(options.json || globals.json, { usage: summary.tokenUsage, daily: summary.daily }, `Sessions: ${summary.sessionCount}\nInput tokens: ${summary.tokenUsage.inputTokens}\nCached input: ${summary.tokenUsage.cachedInputTokens}\nOutput tokens: ${summary.tokenUsage.outputTokens}\nEstimated cost: ${summary.tokenUsage.estimatedCostUsd ?? "unknown"}`);
    });
  });

program
  .command("stats")
  .option("--json", "emit stable JSON output")
  .option("--project <project>", "filter by project")
  .option("--since <date>", "include sessions after this date")
  .option("--until <date>", "include sessions before this date")
  .description("Print indexed session analytics summary.")
  .action(async (options: { project?: string; since?: string; until?: string; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const summary = await new SessionIndexStore(globals.stateDir).analytics(options);
      output(options.json || globals.json, { summary }, `Sessions: ${summary.sessionCount}\nMessages: ${summary.messageCount}\nTools: ${summary.toolCallCount}\nProjects: ${summary.projects.length}`);
    });
  });

program
  .command("publish-session")
  .alias("share-session")
  .argument("<id-or-path>", "indexed session id or source JSONL path")
  .option("--worker-url <url>", "Cloudflare Worker base URL; defaults to WHAT7_WORKER_URL")
  .option("--admin-token <token>", "Worker admin token; defaults to WHAT7_ADMIN_TOKEN")
  .option("--json", "emit stable JSON output")
  .description("Publish an indexed session by id through the Cloudflare Worker backend.")
  .action(async (idOrPath: string, options: { workerUrl?: string; adminToken?: string; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new SessionIndexStore(globals.stateDir);
      const session = await store.find(idOrPath);
      const input = session?.sourcePath ?? idOrPath;
      const workerUrl = options.workerUrl ?? process.env.WHAT7_WORKER_URL;
      const adminToken = options.adminToken ?? process.env.WHAT7_ADMIN_TOKEN;
      if (!workerUrl) throw new Error("Missing Worker URL. Set WHAT7_WORKER_URL or pass --worker-url.");
      const rendered = await renderFile(input, {});
      const client = new PublishClient({ workerUrl, adminToken });
      const published = await client.publish({ title: rendered.title, html: rendered.html, sourcePath: path.resolve(input), sourceHash: rendered.sourceHash });
      const record = await new StateStore(globals.stateDir).add({ remoteId: published.id, url: published.url, sourcePath: path.resolve(input), title: rendered.title, deleteCapability: published.deleteToken, workerUrl, htmlPath: rendered.outputPath });
      output(options.json || globals.json, { record: toSafeRecord(record), url: published.url, local_id: record.localId, remote_id: record.remoteId, session_id: session?.id }, `Published ${published.url}\nLocal record ${record.localId}`);
    });
  });

program
  .command("render")
  .argument("<session.jsonl>", "Codex session JSONL file")
  .option("-o, --output <file>", "HTML output path")
  .option("--title <title>", "override page title")
  .option("--no-redact", "disable default secret redaction")
  .option("--json", "emit stable JSON output")
  .description("Render a session JSONL file to a standalone HTML file.")
  .action(async (input: string, options: { output?: string; title?: string; redact?: boolean; json?: boolean }) => {
    await run(async () => {
      const result = await renderFile(input, {
        outputPath: options.output,
        title: options.title,
        redact: options.redact,
      });
      output(options.json, {
        output_path: result.outputPath,
        title: result.title,
        stats: result.stats,
        redactions: result.redactionCount,
      }, `Rendered ${result.outputPath}`);
    });
  });

program
  .command("preview")
  .argument("<session.jsonl>", "Codex session JSONL file")
  .option("-o, --output <file>", "HTML output path")
  .option("--title <title>", "override page title")
  .option("--port <port>", "preview server port", parsePort)
  .option("--no-open", "do not open the browser")
  .option("--no-redact", "disable default secret redaction")
  .option("--json", "emit server URL as JSON")
  .description("Render and start a local preview server.")
  .action(async (input: string, options: { output?: string; title?: string; port?: number; open?: boolean; redact?: boolean; json?: boolean }) => {
    await run(async () => {
      const result = await renderFile(input, { outputPath: options.output, title: options.title, redact: options.redact });
      const handle = await startStaticFileServer(result.outputPath, options.port ?? 0);
      if (options.open !== false) openBrowser(handle.url);
      output(options.json, { url: handle.url, output_path: result.outputPath }, `Preview: ${handle.url}\nServing ${result.outputPath}\nPress Ctrl-C to stop.`);
    });
  });

program
  .command("publish")
  .argument("<session.jsonl>", "Codex session JSONL file")
  .option("-o, --output <file>", "also write rendered HTML to this path")
  .option("--title <title>", "override page title")
  .option("--worker-url <url>", "Cloudflare Worker base URL; defaults to WHAT7_WORKER_URL")
  .option("--admin-token <token>", "Worker admin token; defaults to WHAT7_ADMIN_TOKEN")
  .option("--no-redact", "disable default secret redaction")
  .option("--json", "emit stable JSON output")
  .description("Render and publish through the Cloudflare Worker backend.")
  .action(async (input: string, options: { output?: string; title?: string; workerUrl?: string; adminToken?: string; redact?: boolean; json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const workerUrl = options.workerUrl ?? process.env.WHAT7_WORKER_URL;
      const adminToken = options.adminToken ?? process.env.WHAT7_ADMIN_TOKEN;
      if (!workerUrl) throw new Error("Missing Worker URL. Set WHAT7_WORKER_URL or pass --worker-url.");
      const rendered = await renderFile(input, { outputPath: options.output, title: options.title, redact: options.redact });
      const client = new PublishClient({ workerUrl, adminToken });
      const published = await client.publish({
        title: rendered.title,
        html: rendered.html,
        sourcePath: path.resolve(input),
        sourceHash: rendered.sourceHash,
      });
      const store = new StateStore(globals.stateDir);
      const record = await store.add({
        remoteId: published.id,
        url: published.url,
        sourcePath: path.resolve(input),
        title: rendered.title,
        deleteCapability: published.deleteToken,
        workerUrl,
        htmlPath: rendered.outputPath,
      });
      output(options.json, { record: toSafeRecord(record), url: published.url, local_id: record.localId, remote_id: record.remoteId }, `Published ${published.url}\nLocal record ${record.localId}`);
    });
  });

program
  .command("list")
  .option("--json", "emit stable JSON output")
  .description("List local publish history.")
  .action(async (options: { json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const records = (await new StateStore(globals.stateDir).list()).map(toSafeRecord);
      if (options.json || globals.json) {
        console.log(JSON.stringify({ records }, null, 2));
      } else if (!records.length) {
        console.log("No published shares recorded.");
      } else {
        for (const record of records) {
          console.log(`${record.localId}\t${record.status}\t${record.title}\t${record.url}`);
        }
      }
    });
  });

program
  .command("unpublish")
  .argument("<id-or-url>", "local id, remote id, or URL from local state")
  .option("--json", "emit stable JSON output")
  .description("Unpublish a remote share using the locally stored delete capability.")
  .action(async (idOrUrl: string, options: { json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new StateStore(globals.stateDir);
      const record = await store.find(idOrUrl);
      if (!record) throw new Error(`No local record found for ${idOrUrl}`);
      if (!record.deleteCapability) throw new Error("Local record is missing delete capability; cannot unpublish safely.");
      if (!record.workerUrl) throw new Error("Local record is missing workerUrl; cannot unpublish safely.");
      const client = new PublishClient({ workerUrl: record.workerUrl });
      const remote = await client.unpublish(record.remoteId, record.deleteCapability);
      const updated = await store.update(record.localId, { status: "unpublished", url: remote.url ?? record.url });
      output(options.json || globals.json, { record: toSafeRecord(updated), remote }, `Unpublished ${updated.url}`);
    });
  });

function addDashboardCommand(name: "dashboard" | "serve"): void {
  program
    .command(name)
    .option("--port <port>", "local dashboard port", parsePort)
    .option("--no-open", "do not open browser")
    .option("--json", "emit server URL as JSON")
    .description("Start the local workbench: browse sessions, preview transcripts, share/unpublish.")
    .action(async (options: { port?: number; open?: boolean; json?: boolean }) => {
      await run(async () => {
        const globals = program.opts<GlobalOptions>();
        const handle = await startDashboard({ stateDir: globals.stateDir, port: options.port ?? 0, open: options.open !== false });
        output(options.json || globals.json, { url: handle.url }, `Dashboard: ${handle.url}\nPress Ctrl-C to stop.`);
      });
    });
}

addDashboardCommand("dashboard");
addDashboardCommand("serve");

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (isCommanderHelp(error)) process.exit(error.exitCode);
  printError(error);
  process.exit(1);
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
}

function output(asJson: boolean | undefined, payload: unknown, text: string): void {
  const globals = program.opts<GlobalOptions>();
  if (asJson || globals.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(text);
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error(`Invalid port: ${value}`);
  return parsed;
}

function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`what7: ${message}`);
}

function isCommanderHelp(error: unknown): error is { exitCode: number } {
  return Boolean(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code).startsWith("commander."));
}
