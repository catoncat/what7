import { computed, ref, watch } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import {
  useCreateShortcutMutation,
  useDeleteShortcutMutation,
  useReorderShortcutsMutation,
  useShortcutsQuery,
  useUpdateShortcutMutation,
} from "@/queries";
import type { Project, Session, Shortcut } from "@/types";

// ---------------------------------------------------------------------------
// Invalid-state (shortcut target probe) is **UI state**, not server state —
// it lives in a module-level ref that all components share. vue-query owns
// the shortcuts list itself.
// ---------------------------------------------------------------------------

const invalid = ref<Set<string>>(new Set());

/** 2h in-memory cache of last probe timestamps (PRD D-11: do not persist). */
const lastValidated = new Map<string, number>();
const VALIDATION_WINDOW_MS = 2 * 60 * 60 * 1000;

// Consumers can import this composable inside <script setup>. It must be
// called from a setup context because vue-query hooks require it.
export function useShortcuts() {
  const query = useShortcutsQuery();
  const createM = useCreateShortcutMutation();
  const updateM = useUpdateShortcutMutation();
  const deleteM = useDeleteShortcutMutation();
  const reorderM = useReorderShortcutsMutation();

  const shortcuts = computed<Shortcut[]>(() => query.data.value ?? []);

  // Revalidate probes whenever the list changes (new fetch / mutation).
  watch(
    () => shortcuts.value.map((s) => s.id).join(","),
    () => {
      void validateAll(shortcuts.value);
    },
    { immediate: true },
  );

  async function refresh(): Promise<void> {
    await query.refetch();
  }

  async function addCurrent(
    route: RouteLocationNormalizedLoaded,
    context: { project?: Project | null; session?: Session | null } = {},
  ): Promise<Shortcut | null> {
    const url = route.fullPath;
    const autoLabel = deriveLabel(route, context);
    const label = promptLabel(autoLabel);
    if (!label) return null;
    const sc = await createM.mutateAsync({ label, url });
    await validateOne(sc);
    return sc;
  }

  async function rename(id: string): Promise<void> {
    const current = shortcuts.value.find((s) => s.id === id);
    if (!current) return;
    const label = promptLabel(current.label, "Rename shortcut");
    if (!label || label === current.label) return;
    await updateM.mutateAsync({ id, patch: { label } });
  }

  async function setIcon(id: string): Promise<void> {
    const current = shortcuts.value.find((s) => s.id === id);
    if (!current) return;
    const next = promptText("Icon (emoji), blank to clear", current.icon ?? "");
    if (next === null) return;
    await updateM.mutateAsync({ id, patch: { icon: next.trim() || "" } });
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
    await deleteM.mutateAsync(id);
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
      window.prompt("Copy URL", absolute);
    }
  }

  async function swapWithNeighbor(id: string, dir: -1 | 1): Promise<void> {
    const list = [...shortcuts.value].sort((a, b) => a.position - b.position);
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[idx]!;
    const b = list[j]!;
    await reorderM.mutateAsync({ a, b });
  }

  return {
    shortcuts,
    invalid: computed(() => invalid.value),
    loading: computed(() => query.isFetching.value),
    loaded: computed(() => query.isSuccess.value),
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
    case "search.session": {
      const title = context.session?.title?.trim();
      return (title && truncate(title, 60)) || "Session";
    }
    case "search":
      return q.q ? `Search: ${truncate(q.q, 24)}` : "Search";
    case "published":
      return "Published";
    case "published.session": {
      const title = context.session?.title?.trim();
      return (title && truncate(title, 60)) || "Session";
    }
    case "settings":
      return "Settings";
    default:
      return route.fullPath;
  }
}

// ---------------------------------------------------------------------------
// Probe helpers (unchanged in behavior, only decoupled from state ownership).
// ---------------------------------------------------------------------------

async function validateAll(list: readonly Shortcut[]): Promise<void> {
  const now = Date.now();
  const toCheck = list.filter((sc) => {
    if (!isInternalUrl(sc.url)) return false;
    const last = lastValidated.get(sc.id);
    return !last || now - last > VALIDATION_WINDOW_MS;
  });
  if (!toCheck.length) return;
  const results = await Promise.allSettled(toCheck.map(probeShortcut));
  const next = new Set(invalid.value);
  results.forEach((r, i) => {
    const sc = toCheck[i]!;
    lastValidated.set(sc.id, now);
    if (r.status === "fulfilled" && r.value === true) next.delete(sc.id);
    else if (r.status === "fulfilled" && r.value === false) next.add(sc.id);
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

async function probeShortcut(sc: Shortcut): Promise<boolean> {
  const apiUrl = mapRouteToApi(sc.url);
  if (!apiUrl) return true;
  const res = await fetch(apiUrl, { method: "GET", headers: { Accept: "application/json" } });
  if (res.status >= 500) throw new Error(`probe ${res.status}`);
  return res.ok;
}

function mapRouteToApi(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin);
    const path = u.pathname;
    const projectMatch = path.match(/^\/p\/([^/]+)(?:\/([^/]+))?$/);
    if (projectMatch) {
      const slug = decodeURIComponent(projectMatch[1] ?? "");
      const sessionId = projectMatch[2];
      if (sessionId) return `/api/v1/sessions/${encodeURIComponent(sessionId)}`;
      return `/api/v1/projects/${encodeURIComponent(slug)}`;
    }
    const sessionMatch = path.match(/^\/s\/([^/]+)$/);
    if (sessionMatch) return `/api/v1/sessions/${encodeURIComponent(sessionMatch[1] ?? "")}`;
    const recentMatch = path.match(/^\/recent\/([^/]+)$/);
    if (recentMatch) return `/api/v1/sessions/${encodeURIComponent(recentMatch[1] ?? "")}`;
    const searchMatch = path.match(/^\/search\/([^/]+)$/);
    if (searchMatch) return `/api/v1/sessions/${encodeURIComponent(searchMatch[1] ?? "")}`;
    const publishedMatch = path.match(/^\/published\/([^/]+)$/);
    if (publishedMatch) return `/api/v1/sessions/${encodeURIComponent(publishedMatch[1] ?? "")}`;
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

function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}
