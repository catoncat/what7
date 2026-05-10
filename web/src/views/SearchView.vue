<script setup lang="ts">
import { computed, inject } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { APP_SHELL_KEY } from "@/shell";
import type { Project, Session } from "@/types";

const shell = inject(APP_SHELL_KEY);
const route = useRoute();
const router = useRouter();

defineProps<{
  projects: readonly Project[];
  sessions: readonly Session[];
  loading: boolean;
  query: string;
}>();

type Since = "" | "1d" | "7d" | "30d";

/**
 * Render a FTS5 snippet (`«match»` style) with the wrapped segments styled.
 * Input is trusted: it comes from our own backend's snippet() or LIKE builder
 * which always escapes the raw content via SQLite's TEXT binding; we only
 * substitute « / » into <mark>.
 */
function highlightSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/«/g, "<mark>")
    .replace(/»/g, "</mark>");
}

const since = computed<Since>(() => {
  const raw = route.query.since;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "1d" || v === "7d" || v === "30d") return v;
  return "";
});
const shared = computed(() => route.query.shared === "1");
const projectSlug = computed(() => String(route.query.project ?? ""));
const q = computed(() => String(route.query.q ?? ""));

function patch(next: Record<string, string | undefined>) {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...next })) {
    if (v === undefined || v === null || v === "") continue;
    query[k] = String(v);
  }
  router.replace({ name: "search", query });
}

function setSince(v: Since) {
  patch({ since: v || undefined });
}
function toggleShared() {
  patch({ shared: shared.value ? undefined : "1" });
}
function setProject(slug: string) {
  patch({ project: slug || undefined });
}
function onInput(ev: Event) {
  const value = (ev.target as HTMLInputElement).value;
  patch({ q: value || undefined });
}
</script>

<template>
  <div class="search">
    <header class="chips">
      <button
        v-if="shell?.isMobile.value"
        class="menu"
        aria-label="Open navigation"
        @click="shell?.openNav()"
      >☰</button>
      <input
        class="q"
        :value="q"
        placeholder="Search sessions"
        @input="onInput"
      />
      <div class="group">
        <button
          v-for="s in (['', '1d', '7d', '30d'] as Since[])"
          :key="s || 'all'"
          :class="{ active: since === s }"
          @click="setSince(s)"
          v-text="s || 'All'"
        />
      </div>
      <label class="shared">
        <input type="checkbox" :checked="shared" @change="toggleShared" />
        <span>Shared only</span>
      </label>
      <select :value="projectSlug" @change="setProject(($event.target as HTMLSelectElement).value)">
        <option value="">All projects</option>
        <option v-for="p in projects" :key="p.slug" :value="p.slug" v-text="p.displayName ?? p.name" />
      </select>
    </header>

    <div v-if="loading" class="hint">Loading…</div>
    <div v-else-if="!sessions.length && (q || since || shared || projectSlug)" class="hint">
      No sessions match this filter.
    </div>
    <div v-else-if="!sessions.length" class="hint">
      Enter a query or pick a filter to start searching.
    </div>

    <ol v-else class="hits">
      <li v-for="s in sessions" :key="s.id">
        <RouterLink :to="{ name: 'search.session', params: { id: s.id }, query: route.query }" class="hit">
          <div class="title" v-text="s.title"></div>
          <div class="meta">
            <span v-text="s.project"></span>
            <span v-text="`${s.messageCount} msgs`"></span>
            <span v-if="s.endedAt" v-text="new Date(s.endedAt).toLocaleDateString()"></span>
          </div>
          <p v-if="s.snippet" class="snippet" v-html="highlightSnippet(s.snippet)"></p>
          <p v-else-if="s.firstMessage" class="snippet" v-text="s.firstMessage"></p>
        </RouterLink>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.search {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
.chips {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 12px 16px;
  position: sticky; top: 0; z-index: 1;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.chips .menu {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 16px;
}
.chips .menu:hover { background: var(--surface-2); color: var(--fg); }
.q {
  flex: 1; min-width: 140px;
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-md); padding: 6px 10px;
  color: var(--fg); font-size: 13px;
}
.group { display: flex; border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; }
.group button {
  padding: 5px 10px;
  background: var(--surface);
  color: var(--fg-3);
  font-size: 11.5px;
}
.group button.active { background: var(--surface-2); color: var(--fg); }
.group button:hover { color: var(--fg); }
.shared {
  display: inline-flex; gap: 6px; align-items: center;
  color: var(--fg-2); font-size: 12px;
  padding: 4px 6px;
  cursor: pointer;
}
.shared input { accent-color: var(--brand); }
select {
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-sm); padding: 4px 8px;
  color: var(--fg-2); font-size: 12px;
}
.hint { color: var(--fg-3); padding: 20px 16px; font-size: 12.5px; }
.hits { list-style: none; padding: 8px 0; margin: 0; }
.hit {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  border-left: 2px solid transparent;
  color: var(--fg-2);
}
.hit:hover { background: var(--surface-2); color: var(--fg); }
.hit.router-link-active {
  background: var(--surface-2);
  border-left-color: var(--accent);
  color: var(--fg);
}
.hit .title {
  color: var(--fg); font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hit .meta {
  display: flex; gap: 8px; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3);
}
.hit .snippet {
  margin: 2px 0 0;
  font-size: 12px; color: var(--fg-2);
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
  -webkit-box-orient: vertical;
}
.hit .snippet mark {
  background: var(--brand-soft);
  color: var(--brand);
  padding: 0 2px;
  border-radius: 2px;
}
</style>
