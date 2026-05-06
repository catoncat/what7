<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useRoute } from "vue-router";
import NavSidebar from "@/components/NavSidebar.vue";
import SessionList from "@/components/SessionList.vue";
import { sessions } from "@/data/mock";
import { APP_SHELL_KEY, type AppShell } from "@/shell";
import type { Session } from "@/types";

const route = useRoute();

interface Filter {
  kind: "scope" | "project" | "agent";
  scope?: string;
  slug?: string;
}

const filter = computed<Filter>(() => {
  const meta = route.meta as { kind?: string; scope?: string };
  if (meta?.kind === "project") return { kind: "project", slug: String(route.params.slug ?? "") };
  if (meta?.kind === "agent") return { kind: "agent", slug: String(route.params.slug ?? "") };
  return { kind: "scope", scope: meta?.scope ?? "inbox" };
});

const filteredSessions = computed<Session[]>(() => {
  const f = filter.value;
  if (f.kind === "project") return sessions.filter((s) => s.project === f.slug);
  if (f.kind === "agent") return sessions.filter((s) => s.agent === f.slug);
  if (f.scope === "pinned") return sessions.filter((s) => s.pinned);
  if (f.scope === "shared") return sessions.filter((s) => s.shared);
  if (f.scope === "drafts") return sessions.filter((s) => s.draft);
  return sessions;
});

const SCOPE_TITLES: Record<string, string> = { inbox: "Recent", pinned: "Pinned", shared: "Shared", drafts: "Drafts" };
const listTitle = computed<string>(() => {
  const f = filter.value;
  if (f.kind === "project") return `Project · ${f.slug}`;
  if (f.kind === "agent") return `Agent · ${f.slug}`;
  return SCOPE_TITLES[f.scope ?? "inbox"] ?? "Recent";
});

const activeId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] : id;
});

const buildLink = (sessionId: string): string => {
  const f = filter.value;
  if (f.kind === "project") return `/projects/${f.slug}/${sessionId}`;
  if (f.kind === "agent") return `/agents/${f.slug}/${sessionId}`;
  return `/${f.scope}/${sessionId}`;
};

// Responsive shell state
const isMobile = ref(false);
const navOpen = ref(false);

let mql: MediaQueryList | null = null;
const syncMobile = (matches: boolean) => { isMobile.value = matches; };

onMounted(() => {
  if (typeof window === "undefined") return;
  mql = window.matchMedia("(max-width: 720px)");
  syncMobile(mql.matches);
  const handler = (e: MediaQueryListEvent) => syncMobile(e.matches);
  mql.addEventListener("change", handler);
  (mql as unknown as { __handler?: (e: MediaQueryListEvent) => void }).__handler = handler;
});
onUnmounted(() => {
  if (!mql) return;
  const handler = (mql as unknown as { __handler?: (e: MediaQueryListEvent) => void }).__handler;
  if (handler) mql.removeEventListener("change", handler);
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
    <SessionList
      :title="listTitle"
      :sessions="filteredSessions"
      :active-id="activeId"
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
/* Global (non-scoped) responsive overrides for child component roots.
   Vue 3 scoped styles cannot reach child component roots, so drawer
   behavior on mobile is expressed here. */
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
  .app .list { display: flex; }
  .app.show-reading .list { display: none; }
}
</style>
