<script setup lang="ts">
import { computed, inject, onMounted, ref, watchEffect } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useProjects } from "@/composables/useProjects";
import { useShortcuts } from "@/composables/useShortcuts";
import { APP_SHELL_KEY } from "@/shell";
import type { Project } from "@/types";

const shell = inject(APP_SHELL_KEY);
const route = useRoute();
const router = useRouter();

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "what7-theme";
const theme = ref<Theme>("auto");

const { projects, refresh: refreshProjects } = useProjects();
const {
  shortcuts,
  refresh: refreshShortcuts,
  addCurrent,
  rename,
  setIcon,
  moveUp,
  moveDown,
  remove,
  copyUrl,
  isInvalid,
} = useShortcuts();

const showHidden = ref(false);
const visibleProjects = computed<Project[]>(() => {
  if (showHidden.value) return [...projects.value];
  return projects.value.filter((p) => !p.hidden);
});
const hiddenCount = computed(() => projects.value.filter((p) => p.hidden).length);

const totalSessions = computed(() =>
  projects.value.reduce((sum, p) => sum + p.sessionCount, 0),
);

const sortedShortcuts = computed(() =>
  [...shortcuts.value].sort((a, b) => a.position - b.position),
);

const currentProject = computed<Project | null>(() => {
  const slug = route.params.slug;
  if (!slug) return null;
  return projects.value.find((p) => p.slug === String(slug)) ?? null;
});

onMounted(async () => {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved === "auto" || saved === "light" || saved === "dark") theme.value = saved;
  await Promise.all([refreshProjects(), refreshShortcuts()]);
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

const openMenuId = ref<string | null>(null);
function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id;
}
function closeMenu() {
  openMenuId.value = null;
}

async function onAddCurrent() {
  await addCurrent(route, { project: currentProject.value });
}

async function onClickShortcut(ev: MouseEvent, id: string, url: string) {
  ev.preventDefault();
  if (isInvalid(id)) {
    const proceed = confirm("This shortcut's target no longer exists. Open it anyway?");
    if (!proceed) return;
  }
  await router.push(url);
}
</script>

<template>
  <aside class="nav" @click="closeMenu">
    <header class="brand">
      <span class="logo">⌘</span>
      <span class="name">what7</span>
      <span class="counter" v-text="totalSessions"></span>
      <button
        v-if="shell?.isMobile.value"
        class="close"
        aria-label="Close navigation"
        @click.stop="shell?.closeNav()"
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
        v-for="p in visibleProjects"
        :key="p.slug"
        :to="{ name: 'project', params: { slug: p.slug } }"
        :title="p.cwd"
        :class="{ hidden: p.hidden }"
      >
        <span class="dot"></span>
        <span class="label" v-text="p.displayName ?? p.name"></span>
        <span class="meta" v-text="p.sessionCount"></span>
      </RouterLink>
      <div v-if="!visibleProjects.length" class="hint">No indexed projects yet.</div>
      <button
        v-if="hiddenCount > 0"
        class="toggle-hidden"
        @click="showHidden = !showHidden"
      >
        <span v-if="!showHidden" v-text="`Show hidden (${hiddenCount})`"></span>
        <span v-else>Hide hidden</span>
      </button>
    </section>
    <section class="group shortcuts">
      <header class="group-head">
        <h3>Shortcuts</h3>
        <button
          class="icon-btn add"
          :title="'Pin current view'"
          aria-label="Pin current view"
          @click.stop="onAddCurrent"
        >+</button>
      </header>
      <div v-if="!sortedShortcuts.length" class="empty">
        <div class="hint">Pin views you return to often.</div>
        <button class="add-primary" @click.stop="onAddCurrent">+ Add current view</button>
      </div>
      <div v-for="s in sortedShortcuts" :key="s.id" class="shortcut-row">
        <a
          :href="s.url"
          class="shortcut"
          :class="{ invalid: isInvalid(s.id) }"
          :title="isInvalid(s.id) ? 'Target not found' : s.url"
          @click="onClickShortcut($event, s.id, s.url)"
        >
          <span class="glyph" v-text="s.icon || '→'"></span>
          <span class="label" v-text="s.label"></span>
        </a>
        <button
          class="icon-btn menu-btn"
          aria-label="Shortcut menu"
          @click.stop="toggleMenu(s.id)"
        >…</button>
        <div v-if="openMenuId === s.id" class="menu" @click.stop>
          <button @click="rename(s.id); closeMenu()">Rename</button>
          <button @click="setIcon(s.id); closeMenu()">Change icon</button>
          <button @click="moveUp(s.id); closeMenu()">Move up</button>
          <button @click="moveDown(s.id); closeMenu()">Move down</button>
          <button @click="copyUrl(s.id); closeMenu()">Copy URL</button>
          <button class="danger" @click="remove(s.id); closeMenu()">Delete</button>
        </div>
      </div>
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
.group a.hidden { color: var(--fg-3); opacity: 0.55; }
.group a.hidden .dot { opacity: 0.4; }
.toggle-hidden {
  margin: 4px 8px 0;
  padding: 4px 8px;
  color: var(--fg-3);
  font-size: 11px;
  background: transparent;
  border-radius: var(--r-sm);
  align-self: flex-start;
  text-align: left;
}
.toggle-hidden:hover { background: var(--surface-2); color: var(--fg-2); }

.group.shortcuts { position: relative; }
.group .group-head {
  display: flex; align-items: center;
  margin: 6px 0 6px;
}
.group .group-head h3 { margin: 0 8px 0; flex: 1; }
.icon-btn {
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border-radius: var(--r-sm);
  color: var(--fg-3);
  font-size: 14px; line-height: 1;
  background: transparent;
}
.icon-btn:hover { background: var(--surface-2); color: var(--fg); }
.group.shortcuts .empty {
  padding: 4px 8px;
  display: flex; flex-direction: column; gap: 6px;
}
.add-primary {
  align-self: flex-start;
  padding: 4px 8px;
  font-size: 11.5px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-sm);
  border: 0;
}
.add-primary:hover { background: var(--brand-soft-hover); }

.shortcut-row {
  display: flex; align-items: center;
  position: relative;
}
.shortcut {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: var(--r-sm); color: var(--fg-2);
  flex: 1; min-width: 0;
}
.shortcut:hover { background: var(--surface-2); color: var(--fg); }
.shortcut.invalid { color: var(--fg-3); opacity: 0.55; }
.shortcut.invalid .glyph { opacity: 0.5; }
.shortcut-row .menu-btn { opacity: 0; }
.shortcut-row:hover .menu-btn { opacity: 1; }
.menu {
  position: absolute; top: 100%; right: 0;
  margin-top: 4px;
  min-width: 140px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex; flex-direction: column;
  padding: 4px;
  z-index: 30;
}
.menu button {
  text-align: left;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 12px;
  background: transparent;
}
.menu button:hover { background: var(--surface-2); color: var(--fg); }
.menu button.danger { color: var(--danger, #e66); }
.menu button.danger:hover { background: rgba(230, 102, 102, 0.12); }

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
