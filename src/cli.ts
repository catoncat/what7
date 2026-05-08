#!/usr/bin/env node
import process from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { startDashboard } from "./dashboard.js";
import { StateStore, toSafeRecord } from "./state.js";
import { SessionIndexStore, syncSessions } from "./sessionIndex.js";
import { PublishClient } from "./publishClient.js";
import { CxsReader, DEFAULT_CXS_DB_PATH } from "./cxsReader.js";

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

program
  .command("list")
  .option("--json", "emit stable JSON output")
  .description("List locally tracked publish history (cron / automation friendly).")
  .action(async (options: { json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const store = new StateStore(globals.stateDir);
      const records = (await store.list()).map(toSafeRecord);
      const asJson = options.json || globals.json;
      if (asJson) console.log(JSON.stringify({ records }, null, 2));
      else if (!records.length) console.log("No published records yet.");
      else {
        for (const r of records) {
          const tag = r.status === "published" ? "✓" : r.status === "unpublished" ? "—" : "!";
          console.log(`${tag} ${r.url}  ${r.title}  (${r.localId})`);
        }
      }
    });
  });

program
  .command("doctor")
  .option("--json", "emit stable JSON output")
  .description("Inspect local environment: cxs db, state dir, worker env, web/dist build.")
  .action(async (options: { json?: boolean }) => {
    await run(async () => {
      const globals = program.opts<GlobalOptions>();
      const report = await runDoctor(globals.stateDir);
      const asJson = options.json || globals.json;
      if (asJson) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      const mark = (ok: boolean | "warn") => (ok === true ? "✓" : ok === "warn" ? "!" : "✗");
      for (const check of report.checks) {
        console.log(`${mark(check.status)} ${check.label}: ${check.detail}`);
      }
      const hasFail = report.checks.some((c) => c.status === false);
      if (hasFail) process.exitCode = 1;
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

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

interface DoctorCheck {
  label: string;
  status: boolean | "warn";
  detail: string;
}

interface DoctorReport {
  state_dir: string;
  cxs_db_path: string;
  worker_url: string | null;
  admin_token_set: boolean;
  checks: DoctorCheck[];
}

async function runDoctor(stateDir?: string): Promise<DoctorReport> {
  const store = new StateStore(stateDir);
  const cxsPath = process.env.CXS_DB ?? DEFAULT_CXS_DB_PATH;
  const workerUrl = process.env.WHAT7_WORKER_URL ?? null;
  const adminToken = Boolean(process.env.WHAT7_ADMIN_TOKEN);
  const checks: DoctorCheck[] = [];

  // cxs db
  try {
    await fs.stat(cxsPath);
    try {
      const reader = new CxsReader(cxsPath);
      const analytics = reader.analytics();
      reader.close();
      checks.push({
        label: "cxs index",
        status: true,
        detail: `${cxsPath} · ${analytics.sessionCount} sessions / ${analytics.projectCount ?? 0} projects`,
      });
    } catch (error) {
      checks.push({
        label: "cxs index",
        status: false,
        detail: `${cxsPath} exists but cannot be opened: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } catch {
    checks.push({
      label: "cxs index",
      status: false,
      detail: `${cxsPath} not found — run 'cxs sync' first.`,
    });
  }

  // state dir
  try {
    await fs.mkdir(store.dir, { recursive: true, mode: 0o700 });
    const state = await store.load();
    checks.push({
      label: "state dir",
      status: true,
      detail: `${store.file} · ${state.records.length} records · ${state.shortcuts.length} shortcuts · ${state.projects.length} project prefs`,
    });
  } catch (error) {
    checks.push({
      label: "state dir",
      status: false,
      detail: `${store.file} not readable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // worker env
  if (workerUrl) {
    checks.push({
      label: "worker url",
      status: true,
      detail: `${workerUrl}${adminToken ? " (admin token set)" : " (no admin token)"}`,
    });
  } else {
    checks.push({
      label: "worker url",
      status: "warn",
      detail: "WHAT7_WORKER_URL not set — publish/unpublish will be disabled.",
    });
  }

  // web/dist
  const distIndex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist", "index.html");
  try {
    await fs.stat(distIndex);
    checks.push({
      label: "web/dist",
      status: true,
      detail: `${distIndex}`,
    });
  } catch {
    checks.push({
      label: "web/dist",
      status: "warn",
      detail: `${distIndex} missing — run 'cd web && vp build' before 'what7 serve'.`,
    });
  }

  return {
    state_dir: store.dir,
    cxs_db_path: cxsPath,
    worker_url: workerUrl,
    admin_token_set: adminToken,
    checks,
  };
}
