<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import NavSidebar from "@/components/NavSidebar.vue";
import SessionList from "@/components/SessionList.vue";
import { sessions } from "@/data/mock";
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
</script>

<template>
  <div class="app">
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
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 240px 380px 1fr;
  height: 100vh;
  background: var(--bg);
  color: var(--fg);
}
.reading {
  border-left: 1px solid var(--line);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
@media (max-width: 1100px) {
  .app { grid-template-columns: 220px 320px 1fr; }
}
</style>
