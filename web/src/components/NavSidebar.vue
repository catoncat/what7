<script setup lang="ts">
import { computed, inject, onMounted, ref, watchEffect } from "vue";
import { RouterLink } from "vue-router";
import { agents, projects, sessions } from "@/data/mock";
import { APP_SHELL_KEY } from "@/shell";

const shell = inject(APP_SHELL_KEY);

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "what7-theme";
const theme = ref<Theme>("auto");

onMounted(() => {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved === "auto" || saved === "light" || saved === "dark") theme.value = saved;
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme.value === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme.value);
  try { localStorage.setItem(THEME_KEY, theme.value); } catch { /* ignore */ }
});

const themeIcon = computed(() => (theme.value === "light" ? "☀" : theme.value === "dark" ? "☾" : "◐"));
const themeLabel = computed(() => (theme.value === "auto" ? "Auto" : theme.value === "light" ? "Light" : "Dark"));

function cycleTheme() {
  theme.value = theme.value === "auto" ? "light" : theme.value === "light" ? "dark" : "auto";
}

const counts = computed(() => ({
  inbox: sessions.length,
  pinned: sessions.filter((s) => s.pinned).length,
  shared: sessions.filter((s) => s.shared).length,
  drafts: sessions.filter((s) => s.draft).length,
}));

const projectCounts = computed(() => {
  const map: Record<string, number> = {};
  for (const s of sessions) map[s.project] = (map[s.project] ?? 0) + 1;
  return map;
});
const agentCounts = computed(() => {
  const map: Record<string, number> = {};
  for (const s of sessions) map[s.agent] = (map[s.agent] ?? 0) + 1;
  return map;
});
</script>

<template>
  <aside class="nav">
    <header class="brand">
      <span class="logo">⌘</span>
      <span class="name">what7</span>
      <span class="counter" v-text="sessions.length"></span>
      <button
        v-if="shell?.isMobile.value"
        class="close"
        aria-label="Close navigation"
        @click="shell?.closeNav()"
      >×</button>
    </header>
    <div class="search">
      <input placeholder="Search sessions" disabled />
      <kbd>⌘K</kbd>
    </div>
    <nav class="primary">
      <RouterLink :to="{ name: 'inbox' }">
        <span>Recent</span><span class="meta" v-text="counts.inbox"></span>
      </RouterLink>
      <RouterLink :to="{ name: 'pinned' }">
        <span>Pinned</span><span class="meta" v-text="counts.pinned"></span>
      </RouterLink>
      <RouterLink :to="{ name: 'shared' }">
        <span>Shared</span><span class="meta" v-text="counts.shared"></span>
      </RouterLink>
      <RouterLink :to="{ name: 'drafts' }">
        <span>Drafts</span><span class="meta" v-text="counts.drafts"></span>
      </RouterLink>
    </nav>
    <section class="group">
      <h3>Projects</h3>
      <RouterLink
        v-for="p in projects"
        :key="p.slug"
        :to="{ name: 'project', params: { slug: p.slug } }"
      >
        <span class="dot" :style="{ background: p.color }"></span>
        <span class="label" v-text="p.name"></span>
        <span class="meta" v-text="projectCounts[p.slug] ?? 0"></span>
      </RouterLink>
    </section>
    <section class="group">
      <h3>Agents</h3>
      <RouterLink
        v-for="a in agents"
        :key="a.slug"
        :to="{ name: 'agent', params: { slug: a.slug } }"
      >
        <span class="glyph" :style="{ color: a.fg, background: a.bg }" v-text="a.glyph"></span>
        <span class="label" v-text="a.name"></span>
        <span class="meta" v-text="agentCounts[a.slug] ?? 0"></span>
      </RouterLink>
    </section>
    <footer class="foot">
      <button class="theme" @click="cycleTheme" :title="`Theme: ${themeLabel}`">
        <span class="theme-icon" v-text="themeIcon"></span>
        <span v-text="themeLabel"></span>
      </button>
      <button>Sync now</button>
    </footer>
  </aside>
</template>

<style scoped>
.nav {
  display: flex; flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--line);
  padding: 12px 10px; overflow-y: auto;
  font-size: 12.5px;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 4px 6px 12px; }
.brand .logo {
  width: 22px; height: 22px; border-radius: 5px;
  background: var(--surface-2); color: var(--fg-2);
  display: grid; place-items: center; font-size: 12px;
}
.brand .name { color: var(--fg); font-weight: 600; flex: 1; }
.brand .counter { color: var(--fg-3); font-family: var(--font-mono); font-size: 11px; }
.brand .close {
  margin-left: 6px;
  width: 26px; height: 26px;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 18px; line-height: 1;
  display: grid; place-items: center;
}
.brand .close:hover { background: var(--surface-2); color: var(--fg); }

.search {
  display: flex; align-items: center; gap: 6px;
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-md); padding: 5px 8px; margin-bottom: 12px;
}
.search input { flex: 1; background: transparent; border: 0; outline: 0; color: var(--fg); font-size: 12.5px; }
.search input::placeholder { color: var(--fg-3); }
.search kbd {
  font-family: var(--font-mono); font-size: 10px; color: var(--fg-3);
  border: 1px solid var(--line); padding: 1px 4px; border-radius: 3px;
}

.primary { display: flex; flex-direction: column; margin-bottom: 12px; }
.primary a, .group a {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: var(--r-sm); color: var(--fg-2);
}
.primary a:hover, .group a:hover { background: var(--surface-2); color: var(--fg); }
.primary a.router-link-active, .group a.router-link-active {
  background: var(--surface-2); color: var(--fg);
  border-left: 2px solid var(--accent); padding-left: 6px;
}
.primary a .meta, .group a .meta {
  margin-left: auto; font-family: var(--font-mono);
  font-size: 11px; color: var(--fg-3);
}
.group { margin-bottom: 12px; }
.group h3 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--fg-3); font-weight: 500; margin: 6px 8px 6px;
}
.group .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.group .glyph {
  width: 18px; height: 18px; border-radius: 4px;
  display: grid; place-items: center;
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
}
.group .label { flex: 1; }

.foot { margin-top: auto; padding: 8px; border-top: 1px solid var(--line); }
.foot { display: flex; flex-direction: column; gap: 6px; }
.foot button {
  width: 100%; padding: 6px;
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-sm); color: var(--fg-2);
}
.foot button:hover { color: var(--fg); }
.foot .theme {
  display: flex; align-items: center; gap: 8px;
  justify-content: flex-start;
  padding-left: 10px;
}
.foot .theme-icon {
  width: 16px; text-align: center;
  color: var(--fg);
}
</style>
