import { readonly, ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import {
  createShortcut,
  deleteShortcut as apiDelete,
  fetchShortcuts,
  updateShortcut as apiUpdate,
} from "@/api/client";
import type { Project, Session, Shortcut } from "@/types";

// ---------------------------------------------------------------------------
// Module-scoped singleton. Vue 3 module-level refs are shared across the app,
// which is what we want for shortcuts: they drive the sidebar regardless of
// where the user is.
// ---------------------------------------------------------------------------

const shortcuts = ref<Shortcut[]>([]);
const invalid = ref<Set<string>>(new Set());
const loading = ref(false);
const loaded = ref(false);

/** Cache validation timestamps in-memory only (PRD D-11). */
const lastValidated = new Map<string, number>();
const VALIDATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function useShortcuts() {
  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      shortcuts.value = await fetchShortcuts();
      loaded.value = true;
      await validateAll();
    } finally {
      loading.value = false;
    }
  }

  async function addCurrent(route: RouteLocationNormalizedLoaded, context: {
    project?: Project | null;
    session?: Session | null;
  } = {}): Promise<Shortcut | null> {
    const url = route.fullPath;
    const autoLabel = deriveLabel(route, context);
    const label = promptLabel(autoLabel);
    if (!label) return null;
    const sc = await createShortcut({ label, url });
    shortcuts.value = [...shortcuts.value, sc];
    await validateOne(sc);
    return sc;
  }

  async function rename(id: string): Promise<void> {
    const current = shortcuts.value.find((s) => s.id === id);
    if (!current) return;
    const label = promptLabel(current.label, "Rename shortcut");
    if (!label || label === current.label) return;
    const updated = await apiUpdate(id, { label });
    replaceInList(updated);
  }

  async function setIcon(id: string): Promise<void> {
    const current = shortcuts.value.find((s) => s.id === id);
    if (!current) return;
    const next = promptText("Icon (emoji), blank to clear", current.icon ?? "");
    if (next === null) return;
    const updated = await apiUpdate(id, { icon: next.trim() || "" });
    replaceInList(updated);
  }

  async function moveUp(id: string): Promise<void> {
    await swapWithNeighbor(id, -1);
  }

  async function moveDown(id: string): Promise<void> {
    await swapWithNeighbor(id, +1);
  }

  async function remove(id: string): Promise<void> {
    const current = shortcuts.value.find((s) => s.id === id);
    if (!current) return;
    if (!confirm(`Delete shortcut "${current.label}"?`)) return;
    await apiDelete(id);
    shortcuts.value = shortcuts.value.filter((s) => s.id !== id);
    invalid.value.delete(id);
    lastValidated.delete(id);
  }

  async function copyUrl(id: string): Promise<void> {
    const current = shortcuts.value.find((s) => s.id === id);
    if (!current) return;
    const absolute = new URL(current.url, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      // Clipboard API can fail in non-secure contexts; fall back to prompt.
      window.prompt("Copy URL", absolute);
    }
  }

  return {
    shortcuts: readonly(shortcuts),
    invalid: readonly(invalid),
    loading: readonly(loading),
    loaded: readonly(loaded),
    refresh,
    addCurrent,
    rename,
    setIcon,
    moveUp,
    moveDown,
    remove,
    copyUrl,
    isInvalid: (id: string) => invalid.value.has(id),
  };
}

// ---------------------------------------------------------------------------
// Label derivation (PRD §6.3)
// ---------------------------------------------------------------------------

export function deriveLabel(
  route: RouteLocationNormalizedLoaded,
  context: { project?: Project | null; session?: Session | null } = {},
): string {
  const name = String(route.name ?? "");
  const q = (route.query ?? {}) as Record<string, string>;
  const suffix = [
    q.since ? ` · ${q.since}` : "",
    q.shared === "1" ? " · shared" : "",
  ].join("");

  switch (name) {
    case "recent":
      return `Recent${suffix}`;
    case "recent.session": {
      const title = context.session?.title?.trim();
      return (title && truncate(title, 60)) || "Session";
    }
    case "project": {
      const label = context.project?.displayName ?? context.project?.name ?? String(route.params.slug ?? "Project");
      return `${label}${suffix}`;
    }
    case "project.session": {
      const title = context.session?.title?.trim();
      return (title && truncate(title, 60)) || "Session";
    }
    case "session": {
      const title = context.session?.title?.trim();
      return (title && truncate(title, 60)) || "Session";
    }
    case "search":
      return q.q ? `Search: ${truncate(q.q, 24)}` : "Search";
    case "published":
      return "Published";
    case "settings":
      return "Settings";
    default:
      return route.fullPath;
  }
}

// ---------------------------------------------------------------------------
// Validation: probe internal routes, skip external https, 2h cache.
// ---------------------------------------------------------------------------

async function validateAll(): Promise<void> {
  const now = Date.now();
  const toCheck = shortcuts.value.filter((sc) => {
    if (!isInternalUrl(sc.url)) return false;
    const last = lastValidated.get(sc.id);
    return !last || now - last > VALIDATION_WINDOW_MS;
  });
  const results = await Promise.allSettled(toCheck.map(probeShortcut));
  const next = new Set(invalid.value);
  results.forEach((r, i) => {
    const sc = toCheck[i]!;
    lastValidated.set(sc.id, now);
    if (r.status === "fulfilled" && r.value === true) next.delete(sc.id);
    else if (r.status === "fulfilled" && r.value === false) next.add(sc.id);
    // 5xx / network error: leave prior state unchanged
  });
  invalid.value = next;
}

async function validateOne(sc: Shortcut): Promise<void> {
  if (!isInternalUrl(sc.url)) return;
  try {
    const ok = await probeShortcut(sc);
    lastValidated.set(sc.id, Date.now());
    const next = new Set(invalid.value);
    if (ok) next.delete(sc.id);
    else next.add(sc.id);
    invalid.value = next;
  } catch {
    // leave prior state
  }
}

function isInternalUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Return true if target exists, false on 4xx (invalid), throws on 5xx/network
 * so the caller can leave state unchanged.
 */
async function probeShortcut(sc: Shortcut): Promise<boolean> {
  const apiUrl = mapRouteToApi(sc.url);
  if (!apiUrl) return true; // unknown internal shape; optimistic
  const res = await fetch(apiUrl, { method: "GET", headers: { Accept: "application/json" } });
  if (res.status >= 500) throw new Error(`probe ${res.status}`);
  return res.ok;
}

/**
 * Map a frontend router path to the /api/v1 endpoint that proves existence.
 * Returns null when the path doesn't address a concrete entity (e.g. /recent,
 * /search, /settings) — those are always valid.
 */
function mapRouteToApi(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin);
    const path = u.pathname;
    // /p/:slug or /p/:slug/:id
    const projectMatch = path.match(/^\/p\/([^/]+)(?:\/([^/]+))?$/);
    if (projectMatch) {
      const slug = decodeURIComponent(projectMatch[1] ?? "");
      const sessionId = projectMatch[2];
      if (sessionId) return `/api/v1/sessions/${encodeURIComponent(sessionId)}`;
      return `/api/v1/projects/${encodeURIComponent(slug)}`;
    }
    // /s/:id
    const sessionMatch = path.match(/^\/s\/([^/]+)$/);
    if (sessionMatch) return `/api/v1/sessions/${encodeURIComponent(sessionMatch[1] ?? "")}`;
    // /recent/:id
    const recentMatch = path.match(/^\/recent\/([^/]+)$/);
    if (recentMatch) return `/api/v1/sessions/${encodeURIComponent(recentMatch[1] ?? "")}`;
    // /recent, /search, /published, /settings — no concrete target
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function promptLabel(preset: string, title = "Pin this view"): string | null {
  const v = window.prompt(title, preset);
  if (v === null) return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function promptText(title: string, preset: string): string | null {
  const v = window.prompt(title, preset);
  if (v === null) return null;
  return v;
}

function replaceInList(next: Shortcut): void {
  shortcuts.value = shortcuts.value.map((s) => (s.id === next.id ? next : s));
}

async function swapWithNeighbor(id: string, dir: -1 | 1): Promise<void> {
  const list = [...shortcuts.value].sort((a, b) => a.position - b.position);
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const j = idx + dir;
  if (j < 0 || j >= list.length) return;
  const a = list[idx]!;
  const b = list[j]!;
  // Swap positions; if they tie, nudge by 1 so the order actually changes.
  const nextA = b.position === a.position ? a.position + dir : b.position;
  const nextB = b.position === a.position ? a.position : a.position;
  const [u1, u2] = await Promise.all([
    apiUpdate(a.id, { position: nextA }),
    apiUpdate(b.id, { position: nextB }),
  ]);
  shortcuts.value = shortcuts.value.map((s) => {
    if (s.id === u1.id) return u1;
    if (s.id === u2.id) return u2;
    return s;
  });
}

function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}
