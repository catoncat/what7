#!/usr/bin/env node
import process from "node:process";
import { Command } from "commander";
import { startDashboard } from "./dashboard.js";
import { StateStore, toSafeRecord } from "./state.js";
import { SessionIndexStore, syncSessions } from "./sessionIndex.js";
import { PublishClient } from "./publishClient.js";

interface GlobalOptions {
  stateDir?: string;
  json?: boolean;
}

const program = new Command();

program
  .name("what7")
  .description("Local session workbench backed by the cxs SQLite index.")
  .version("0.1.0")
  .option("--state-dir <dir>", "override local state directory")
  .option("--json", "emit stable JSON output");

program
  .command("sync")
  .option("--dir <dir>", "session root to scan; can be repeated", collect, [] as string[])
  .option("--max-files <n>", "maximum JSONL files to scan", parsePositiveInt)
  .option("--json", "emit stable JSON output")
  .description("Discover Codex sessions and refresh the local cxs session index.")
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
    .description("Start the local workbench: browse cxs-indexed sessions, preview transcripts, share/unpublish.")
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
