<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useRoute } from "vue-router";
import NavSidebar from "@/components/NavSidebar.vue";
import SessionList from "@/components/SessionList.vue";
import SearchView from "@/views/SearchView.vue";
import { fetchProjects, fetchProjectSessions, fetchSessions } from "@/api/client";
import { APP_SHELL_KEY, type AppShell } from "@/shell";
import type { Project, Session } from "@/types";

const route = useRoute();

type FilterKind = "recent" | "project" | "search" | "published";
interface Filter {
  kind: FilterKind;
  slug?: string;
  q?: string;
  since?: string;
  project?: string;
  shared?: boolean;
}

const filter = computed<Filter>(() => {
  const meta = route.meta as { kind?: string };
  const q = (route.query ?? {}) as Record<string, string>;
  if (meta?.kind === "project") return { kind: "project", slug: String(route.params.slug ?? "") };
  if (meta?.kind === "search") {
    return {
      kind: "search",
      q: q.q,
      since: q.since,
      project: q.project,
      shared: q.shared === "1",
    };
  }
  if (meta?.kind === "published") {
    return { kind: "published", since: q.since, project: q.project, shared: true };
  }
  return { kind: "recent" };
});

const sessions = ref<Session[]>([]);
const projects = ref<Project[]>([]);
const loading = ref(false);

async function loadSessions(f: Filter) {
  if (f.kind === "recent") {
    loading.value = true;
    const result = await fetchSessions({ limit: 100 });
    sessions.value = result.sessions;
    loading.value = false;
    return;
  }
  if (f.kind === "project" && f.slug) {
    loading.value = true;
    const result = await fetchProjectSessions(f.slug, { limit: 100 });
    sessions.value = result.sessions;
    loading.value = false;
    return;
  }
  if (f.kind === "search" || f.kind === "published") {
    // Only fetch when at least one signal is set, otherwise show empty hint.
    const hasSignal =
      f.kind === "published" || Boolean(f.q || f.since || f.project || f.shared);
    if (!hasSignal) {
      sessions.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    const result = await fetchSessions({
      limit: 100,
      ...(f.q ? { q: f.q } : {}),
      ...(f.since ? { since: sinceToIso(f.since) } : {}),
      ...(f.project ? { project: f.project } : {}),
      ...(f.shared ? { shared: 1 } : {}),
    });
    sessions.value = result.sessions;
    loading.value = false;
    return;
  }
  sessions.value = [];
  loading.value = false;
}

function sinceToIso(since: string): string {
  const days = since === "1d" ? 1 : since === "7d" ? 7 : since === "30d" ? 30 : 0;
  if (!days) return since;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

watch(filter, (f) => loadSessions(f), { immediate: true, deep: true });

onMounted(async () => {
  projects.value = await fetchProjects();
});

const listTitle = computed<string>(() => {
  if (filter.value.kind === "project") {
    const first = sessions.value[0];
    return first ? `Project · ${first.project}` : `Project`;
  }
  if (filter.value.kind === "recent") return "Recent";
  if (filter.value.kind === "published") return "Published";
  const meta = route.meta as { kind?: string };
  if (meta?.kind === "settings") return "Settings";
  return "Recent";
});

const activeId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] : id;
});

const buildLink = (sessionId: string): string => {
  const f = filter.value;
  if (f.kind === "project") return `/p/${f.slug}/${sessionId}`;
  if (f.kind === "search") {
    const qs = new URLSearchParams(route.query as Record<string, string>).toString();
    return `/search/${sessionId}${qs ? `?${qs}` : ""}`;
  }
  if (f.kind === "published") {
    // No /published/:id route yet (M4.4); reuse the session direct-link.
    return `/s/${sessionId}`;
  }
  return `/recent/${sessionId}`;
};

// Responsive shell state
const isMobile = ref(false);
const navOpen = ref(false);

let mql: MediaQueryList | null = null;
let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

onMounted(() => {
  if (typeof window === "undefined") return;
  mql = window.matchMedia("(max-width: 720px)");
  isMobile.value = mql.matches;
  mqlHandler = (e: MediaQueryListEvent) => { isMobile.value = e.matches; };
  mql.addEventListener("change", mqlHandler);
});
onUnmounted(() => {
  if (mql && mqlHandler) mql.removeEventListener("change", mqlHandler);
});

watch(() => route.fullPath, () => { navOpen.value = false; });

const shell: AppShell = {
  isMobile,
  navOpen,
  openNav: () => { navOpen.value = true; },
  closeNav: () => { navOpen.value = false; },
};
provide(APP_SHELL_KEY, shell);
</script>

<template>
  <div
    class="app"
    :class="{ 'is-mobile': isMobile, 'show-reading': !!activeId, 'nav-open': navOpen }"
  >
    <NavSidebar />
    <SearchView
      v-if="filter.kind === 'search'"
      :projects="projects"
      :sessions="sessions"
      :loading="loading"
      :query="filter.q ?? ''"
    />
    <SessionList
      v-else
      :title="listTitle"
      :sessions="sessions"
      :active-id="activeId"
      :loading="loading"
      :build-link="buildLink"
    />
    <main class="reading">
      <RouterView name="reading" />
    </main>
    <div
      v-if="isMobile && navOpen"
      class="backdrop"
      role="button"
      aria-label="Close navigation"
      @click="navOpen = false"
    ></div>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 240px 380px 1fr;
  height: 100vh;
  height: 100dvh;
  background: var(--bg);
  color: var(--fg);
  position: relative;
  overflow: hidden;
}
.reading {
  border-left: 1px solid var(--line);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 15;
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}
@media (max-width: 1100px) {
  .app { grid-template-columns: 220px 320px 1fr; }
}
@media (max-width: 880px) {
  .app { grid-template-columns: 200px 300px 1fr; }
}
@media (max-width: 720px) {
  .app { grid-template-columns: 1fr; }
  .app .reading { display: none; border-left: 0; }
  .app.show-reading .reading { display: flex; }
}
</style>

<style>
@media (max-width: 720px) {
  .app .nav {
    position: fixed;
    top: 0; bottom: 0; left: 0;
    width: min(284px, 84vw);
    z-index: 20;
    transform: translateX(-100%);
    transition: transform 220ms ease;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.35);
    border-right: 1px solid var(--line);
  }
  .app.nav-open .nav { transform: translateX(0); }
  .app .list, .app .search { display: flex; }
  .app.show-reading .list, .app.show-reading .search { display: none; }
}
</style>
