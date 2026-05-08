<script setup lang="ts">
import { computed, inject, onMounted, ref, watchEffect } from "vue";
import { RouterLink } from "vue-router";
import { fetchProjects, fetchShortcuts } from "@/api/client";
import { APP_SHELL_KEY } from "@/shell";
import type { Project, Shortcut } from "@/types";

const shell = inject(APP_SHELL_KEY);

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "what7-theme";
const theme = ref<Theme>("auto");

const projects = ref<Project[]>([]);
const shortcuts = ref<Shortcut[]>([]);
const totalSessions = computed(() =>
  projects.value.reduce((sum, p) => sum + p.sessionCount, 0),
);

onMounted(async () => {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved === "auto" || saved === "light" || saved === "dark") theme.value = saved;
  const [proj, sc] = await Promise.all([fetchProjects(), fetchShortcuts()]);
  projects.value = proj;
  shortcuts.value = sc;
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme.value === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme.value);
  localStorage.setItem(THEME_KEY, theme.value);
});

const themeIcon = computed(() =>
  theme.value === "light" ? "☀" : theme.value === "dark" ? "☾" : "◐",
);
const themeLabel = computed(() =>
  theme.value === "auto" ? "Auto" : theme.value === "light" ? "Light" : "Dark",
);

function cycleTheme() {
  theme.value = theme.value === "auto" ? "light" : theme.value === "light" ? "dark" : "auto";
}
</script>

<template>
  <aside class="nav">
    <header class="brand">
      <span class="logo">⌘</span>
      <span class="name">what7</span>
      <span class="counter" v-text="totalSessions"></span>
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
      <RouterLink :to="{ name: 'recent' }">
        <span>Recent</span><span class="meta" v-text="totalSessions"></span>
      </RouterLink>
      <RouterLink :to="{ name: 'search' }">
        <span>Search</span>
      </RouterLink>
      <RouterLink :to="{ name: 'published' }">
        <span>Published</span>
      </RouterLink>
    </nav>
    <section class="group">
      <h3>Projects</h3>
      <RouterLink
        v-for="p in projects"
        :key="p.slug"
        :to="{ name: 'project', params: { slug: p.slug } }"
        :title="p.cwd"
      >
        <span class="dot"></span>
        <span class="label" v-text="p.displayName ?? p.name"></span>
        <span class="meta" v-text="p.sessionCount"></span>
      </RouterLink>
      <div v-if="!projects.length" class="hint">No indexed projects yet.</div>
    </section>
    <section v-if="shortcuts.length" class="group">
      <h3>Shortcuts</h3>
      <a v-for="s in shortcuts" :key="s.id" :href="s.url" class="shortcut">
        <span class="glyph" v-text="s.icon ?? '→'"></span>
        <span class="label" v-text="s.label"></span>
      </a>
    </section>
    <footer class="foot">
      <RouterLink class="settings-link" :to="{ name: 'settings' }">
        <span>Settings</span>
      </RouterLink>
      <button class="theme" @click="cycleTheme" :title="`Theme: ${themeLabel}`">
        <span class="theme-icon" v-text="themeIcon"></span>
        <span v-text="themeLabel"></span>
      </button>
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
.group .dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  background: var(--accent);
}
.group .glyph {
  width: 18px; height: 18px; border-radius: 4px;
  display: grid; place-items: center;
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  background: var(--surface-2); color: var(--fg-2);
}
.group .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group .hint { color: var(--fg-3); padding: 4px 8px; font-size: 11.5px; }
.shortcut {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: var(--r-sm); color: var(--fg-2);
}
.shortcut:hover { background: var(--surface-2); color: var(--fg); }

.foot { margin-top: auto; padding: 8px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.foot button {
  width: 100%; padding: 6px;
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-sm); color: var(--fg-2);
}
.foot button:hover { color: var(--fg); }
.foot .settings-link {
  padding: 6px 10px;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 12.5px;
}
.foot .settings-link:hover { background: var(--surface-2); color: var(--fg); }
.foot .settings-link.router-link-active { background: var(--surface-2); color: var(--fg); }
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
