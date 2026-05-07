import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { PublishRecord, SafePublishRecord, Shortcut, StateFile } from "./types.js";

const STATE_VERSION = 1 as const;

export function getDefaultStateDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.WHAT7_STATE_DIR) return path.resolve(process.env.WHAT7_STATE_DIR);
  if (process.env.XDG_STATE_HOME) return path.join(process.env.XDG_STATE_HOME, "what7");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "what7");
  return path.join(os.homedir(), ".local", "state", "what7");
}

export class StateStore {
  readonly dir: string;
  readonly file: string;

  constructor(dir?: string) {
    this.dir = getDefaultStateDir(dir);
    this.file = path.join(this.dir, "state.json");
  }

  async load(): Promise<StateFile> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<StateFile>;
      if (
        parsed.version !== STATE_VERSION ||
        !Array.isArray(parsed.records) ||
        !Array.isArray(parsed.shortcuts)
      ) {
        throw new Error(`Unsupported state file: ${this.file}`);
      }
      return {
        version: STATE_VERSION,
        records: parsed.records,
        shortcuts: parsed.shortcuts,
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { version: STATE_VERSION, records: [], shortcuts: [] };
      }
      throw error;
    }
  }

  async save(state: StateFile): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  async list(): Promise<PublishRecord[]> {
    const state = await this.load();
    return [...state.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async add(record: Omit<PublishRecord, "localId" | "createdAt" | "updatedAt" | "status"> & Partial<Pick<PublishRecord, "localId" | "createdAt" | "updatedAt" | "status">>): Promise<PublishRecord> {
    const now = new Date().toISOString();
    const full: PublishRecord = {
      localId: record.localId ?? makeLocalId(),
      createdAt: record.createdAt ?? now,
      updatedAt: record.updatedAt ?? now,
      status: record.status ?? "published",
      ...record,
    };
    const state = await this.load();
    state.records.unshift(full);
    await this.save(state);
    return full;
  }

  async update(localId: string, patch: Partial<PublishRecord>): Promise<PublishRecord> {
    const state = await this.load();
    const index = state.records.findIndex((record) => record.localId === localId);
    if (index === -1) throw new Error(`No local record found for ${localId}`);
    const current = state.records[index];
    if (!current) throw new Error(`No local record found for ${localId}`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    state.records[index] = next;
    await this.save(state);
    return next;
  }

  async find(idOrUrl: string): Promise<PublishRecord | undefined> {
    const state = await this.load();
    return state.records.find(
      (record) => record.localId === idOrUrl || record.remoteId === idOrUrl || record.url === idOrUrl,
    );
  }

  async listShortcuts(): Promise<Shortcut[]> {
    const state = await this.load();
    return [...state.shortcuts].sort((a, b) => a.position - b.position);
  }

  async addShortcut(input: {
    label: string;
    url: string;
    icon?: string;
    position?: number;
  }): Promise<Shortcut> {
    const now = new Date().toISOString();
    const state = await this.load();
    const maxPos = state.shortcuts.reduce((m, s) => Math.max(m, s.position), -1);
    const sc: Shortcut = {
      id: makeShortcutId(),
      label: input.label,
      url: input.url,
      ...(input.icon ? { icon: input.icon } : {}),
      position: input.position ?? maxPos + 1,
      createdAt: now,
      updatedAt: now,
    };
    state.shortcuts.push(sc);
    await this.save(state);
    return sc;
  }

  async updateShortcut(
    id: string,
    patch: Partial<Pick<Shortcut, "label" | "url" | "icon" | "position">>,
  ): Promise<Shortcut> {
    const state = await this.load();
    const idx = state.shortcuts.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`No shortcut found for ${id}`);
    const next: Shortcut = {
      ...state.shortcuts[idx]!,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    state.shortcuts[idx] = next;
    await this.save(state);
    return next;
  }

  async deleteShortcut(id: string): Promise<boolean> {
    const state = await this.load();
    const before = state.shortcuts.length;
    state.shortcuts = state.shortcuts.filter((s) => s.id !== id);
    if (state.shortcuts.length === before) return false;
    await this.save(state);
    return true;
  }
}

export function toSafeRecord(record: PublishRecord): SafePublishRecord {
  const { deleteCapability: _deleteCapability, ...safe } = record;
  return { ...safe, hasDeleteCapability: Boolean(_deleteCapability) };
}

export function makeLocalId(): string {
  return `loc_${crypto.randomBytes(8).toString("hex")}`;
}

export function makeShortcutId(): string {
  return `sc_${crypto.randomBytes(6).toString("hex")}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
