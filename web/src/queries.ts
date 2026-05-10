/**
 * Central registry of vue-query query keys, queryOptions, and mutation
 * factories. Components / composables consume these so cache semantics live
 * in one place.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationFunction,
  type QueryKey,
} from "@tanstack/vue-query";
import { computed, type MaybeRefOrGetter, toValue } from "vue";
import {
  createShortcut as apiCreateShortcut,
  deleteShortcut as apiDeleteShortcut,
  fetchProject,
  fetchProjects,
  fetchProjectSessions,
  fetchSessionDetail,
  fetchSessions,
  fetchShortcuts,
  shareSession as apiShareSession,
  updateProject as apiUpdateProject,
  updateShortcut as apiUpdateShortcut,
  type SessionDetailResponse,
  type SessionPage,
} from "@/api/client";
import type { Project, Shortcut } from "@/types";

// ---------------------------------------------------------------------------
// Query keys — centralize so invalidations stay in sync.
// ---------------------------------------------------------------------------

export const qk = {
  projects: () => ["projects"] as const,
  project: (slug: string) => ["project", slug] as const,
  sessions: (params: Record<string, unknown>) => ["sessions", params] as const,
  projectSessions: (slug: string, params: Record<string, unknown>) =>
    ["projectSessions", slug, params] as const,
  sessionDetail: (id: string) => ["session", id] as const,
  shortcuts: () => ["shortcuts"] as const,
} as const;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function useProjectsQuery() {
  return useQuery({
    queryKey: qk.projects(),
    queryFn: fetchProjects,
    staleTime: 5 * 60_000,
  });
}

export function useProjectQuery(slug: MaybeRefOrGetter<string | undefined>) {
  return useQuery({
    queryKey: computed(() => qk.project(String(toValue(slug) ?? ""))),
    queryFn: () => {
      const s = toValue(slug);
      if (!s) throw new Error("slug required");
      return fetchProject(s);
    },
    enabled: computed(() => !!toValue(slug)),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionsParams {
  limit?: number;
  offset?: number;
  q?: string;
  since?: string;
  until?: string;
  project?: string;
  shared?: 1;
}

export function useSessionsQuery(params: MaybeRefOrGetter<SessionsParams>) {
  return useQuery({
    queryKey: computed<QueryKey>(() => qk.sessions(toValue(params) as Record<string, unknown>)),
    queryFn: () => fetchSessions(toValue(params)),
    staleTime: 30_000,
    placeholderData: (prev: SessionPage | undefined) => prev,
  });
}

export function useProjectSessionsQuery(
  slug: MaybeRefOrGetter<string | undefined>,
  params: MaybeRefOrGetter<Omit<SessionsParams, "project">>,
) {
  return useQuery({
    queryKey: computed<QueryKey>(() =>
      qk.projectSessions(String(toValue(slug) ?? ""), toValue(params) as Record<string, unknown>),
    ),
    queryFn: () => {
      const s = toValue(slug);
      if (!s) throw new Error("slug required");
      return fetchProjectSessions(s, toValue(params));
    },
    enabled: computed(() => !!toValue(slug)),
    staleTime: 30_000,
    placeholderData: (prev: SessionPage | undefined) => prev,
  });
}

export function useSessionDetailQuery(id: MaybeRefOrGetter<string | undefined>) {
  return useQuery({
    queryKey: computed(() => qk.sessionDetail(String(toValue(id) ?? ""))),
    queryFn: () => {
      const sid = toValue(id);
      if (!sid) throw new Error("id required");
      return fetchSessionDetail(sid);
    },
    enabled: computed(() => !!toValue(id)),
    // Single session is immutable from cxs's POV; only invalidate explicitly.
    staleTime: Infinity,
    placeholderData: (prev: SessionDetailResponse | undefined) => prev,
  });
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

export function useShortcutsQuery() {
  return useQuery({
    queryKey: qk.shortcuts(),
    queryFn: fetchShortcuts,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useUpdateProjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, patch }: { slug: string; patch: { displayName?: string | null; hidden?: boolean } }) =>
      apiUpdateProject(slug, patch),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: qk.projects() });
      qc.invalidateQueries({ queryKey: qk.project(slug) });
    },
  });
}

export function useCreateShortcutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateShortcut,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shortcuts() });
    },
  });
}

export function useUpdateShortcutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof apiUpdateShortcut>[1] }) =>
      apiUpdateShortcut(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shortcuts() });
    },
  });
}

export function useDeleteShortcutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteShortcut,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shortcuts() });
    },
  });
}

/**
 * Reorder two shortcuts atomically (optimistic update).
 * The only place we take optimistic update risk per PRD — swapping positions
 * is safe to roll back if either PATCH fails.
 */
export function useReorderShortcutsMutation() {
  const qc = useQueryClient();
  type Args = { a: Shortcut; b: Shortcut };
  const mutationFn: MutationFunction<[Shortcut, Shortcut], Args> = async ({ a, b }) => {
    // Swap positions; if they tie, nudge by 1 so the order actually changes.
    const dir = a.position <= b.position ? 1 : -1;
    const nextA = b.position === a.position ? a.position + dir : b.position;
    const nextB = b.position === a.position ? a.position : a.position;
    const [u1, u2] = await Promise.all([
      apiUpdateShortcut(a.id, { position: nextA }),
      apiUpdateShortcut(b.id, { position: nextB }),
    ]);
    return [u1, u2];
  };
  return useMutation({
    mutationFn,
    onMutate: async ({ a, b }) => {
      await qc.cancelQueries({ queryKey: qk.shortcuts() });
      const prev = qc.getQueryData<Shortcut[]>(qk.shortcuts());
      if (prev) {
        const dir = a.position <= b.position ? 1 : -1;
        const nextA = b.position === a.position ? a.position + dir : b.position;
        const nextB = b.position === a.position ? a.position : a.position;
        qc.setQueryData<Shortcut[]>(
          qk.shortcuts(),
          prev.map((s) =>
            s.id === a.id ? { ...s, position: nextA } : s.id === b.id ? { ...s, position: nextB } : s,
          ),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.shortcuts(), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.shortcuts() });
    },
  });
}

export function useShareSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiShareSession,
    onSuccess: () => {
      // shares endpoint currently not queried; no-op. Kept as hook so future
      // Published view can invalidate it consistently.
      qc.invalidateQueries({ queryKey: ["shares"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard for the typical project list consumer: resolves cached or live data. */
export function readCachedProjects(qc: ReturnType<typeof useQueryClient>): Project[] | undefined {
  return qc.getQueryData<Project[]>(qk.projects());
}
