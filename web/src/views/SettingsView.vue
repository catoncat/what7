<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { APP_SHELL_KEY } from "@/shell";
import { useProjects } from "@/composables/useProjects";

const shell = inject(APP_SHELL_KEY);
const { projects, refresh, patch } = useProjects();

type Landing = "recent" | "last-active";
const LANDING_KEY = "what7-default-landing";
const THEME_KEY = "what7-theme";

const landing = ref<Landing>("recent");
const theme = ref<"auto" | "light" | "dark">("auto");

onMounted(async () => {
  const savedLanding = localStorage.getItem(LANDING_KEY);
  if (savedLanding === "recent" || savedLanding === "last-active") landing.value = savedLanding;
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "auto" || savedTheme === "light" || savedTheme === "dark") theme.value = savedTheme;
  if (!projects.value.length) await refresh();
});

watch(landing, (v) => localStorage.setItem(LANDING_KEY, v));
watch(theme, (v) => {
  localStorage.setItem(THEME_KEY, v);
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (v === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", v);
});

const editingSlug = ref<string | null>(null);
const editingValue = ref("");

function startEdit(slug: string, current: string) {
  editingSlug.value = slug;
  editingValue.value = current;
}
async function commitEdit(slug: string) {
  const next = editingValue.value.trim();
  const current = projects.value.find((p) => p.slug === slug);
  if (!current) {
    editingSlug.value = null;
    return;
  }
  const prior = current.displayName ?? "";
  if (next === prior) {
    editingSlug.value = null;
    return;
  }
  await patch(slug, { displayName: next || null });
  editingSlug.value = null;
}
function cancelEdit() {
  editingSlug.value = null;
}

async function toggleHidden(slug: string, current: boolean | undefined) {
  await patch(slug, { hidden: !current });
}

const sortedProjects = computed(() =>
  [...projects.value].sort((a, b) => (b.sessionCount ?? 0) - (a.sessionCount ?? 0)),
);

const stateDir = ref<string>("server default (XDG_STATE_HOME · ~/Library/Application Support/what7)");
</script>

<template>
  <section class="settings">
    <header class="head">
      <button
        v-if="shell?.isMobile.value"
        class="menu"
        aria-label="Open navigation"
        @click="shell?.openNav()"
      >☰</button>
      <h1>Settings</h1>
    </header>

    <article class="card">
      <header>
        <h2>Projects</h2>
        <p>Rename sidebar label or hide long-tail projects. slug / cwd stay intact.</p>
      </header>
      <div class="table">
        <div class="row head">
          <span>Display name</span>
          <span>Slug</span>
          <span>Sessions</span>
          <span>Hidden</span>
        </div>
        <div v-for="p in sortedProjects" :key="p.slug" class="row">
          <span v-if="editingSlug !== p.slug" class="name" @click="startEdit(p.slug, p.displayName ?? '')">
            <span v-text="p.displayName || p.name"></span>
            <span v-if="p.displayName" class="alias-hint">· alias</span>
          </span>
          <span v-else class="name">
            <input
              ref="editInput"
              v-model="editingValue"
              :placeholder="p.name"
              @keyup.enter="commitEdit(p.slug)"
              @keyup.esc="cancelEdit()"
              @blur="commitEdit(p.slug)"
            />
          </span>
          <code class="slug" v-text="p.slug"></code>
          <span class="count" v-text="p.sessionCount"></span>
          <label class="toggle">
            <input type="checkbox" :checked="!!p.hidden" @change="toggleHidden(p.slug, p.hidden)" />
          </label>
        </div>
      </div>
    </article>

    <article class="card">
      <header>
        <h2>Default landing</h2>
        <p>Where the app opens at <code>/</code>.</p>
      </header>
      <div class="choices">
        <label><input type="radio" value="recent" v-model="landing" /> <span>Recent (global)</span></label>
        <label><input type="radio" value="last-active" v-model="landing" /> <span>Last active project</span></label>
      </div>
    </article>

    <article class="card">
      <header>
        <h2>Theme</h2>
        <p>Mirrors the toggle at the bottom of the sidebar.</p>
      </header>
      <div class="choices">
        <label><input type="radio" value="auto" v-model="theme" /> <span>Auto</span></label>
        <label><input type="radio" value="light" v-model="theme" /> <span>Light</span></label>
        <label><input type="radio" value="dark" v-model="theme" /> <span>Dark</span></label>
      </div>
    </article>

    <article class="card">
      <header>
        <h2>State directory</h2>
        <p>Where what7 keeps publish history, shortcuts, and project prefs.</p>
      </header>
      <code class="state-dir" v-text="stateDir"></code>
    </article>
  </section>
</template>

<style scoped>
.settings {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
.head {
  position: sticky; top: 0; z-index: 1;
  display: flex; gap: 8px; align-items: center;
  padding: 14px 20px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.head .menu {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 16px;
}
.head .menu:hover { background: var(--surface-2); color: var(--fg); }
.head h1 { margin: 0; font-size: 14px; font-weight: 600; color: var(--fg); }

.card {
  margin: 20px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
}
.card > header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}
.card h2 { margin: 0 0 4px; font-size: 12.5px; font-weight: 600; color: var(--fg); }
.card header p { margin: 0; color: var(--fg-3); font-size: 11.5px; }

.table {
  padding: 4px 8px 8px;
  max-height: 360px;
  overflow-y: auto;
}
.row {
  display: grid;
  grid-template-columns: 1.5fr 1.2fr 70px 60px;
  gap: 8px; align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--fg);
}
.row:last-child { border-bottom: 0; }
.row.head {
  font-size: 10.5px;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--fg-3);
  border-bottom: 1px solid var(--line);
}
.row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
.row .name input {
  width: 100%;
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-sm); padding: 4px 6px;
  color: var(--fg); font-size: 12.5px;
}
.row .alias-hint {
  color: var(--fg-3); font-size: 10.5px; margin-left: 6px;
}
.row .slug {
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row .count {
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3);
}
.toggle {
  display: inline-flex; justify-content: center;
}
.toggle input { accent-color: var(--brand); }

.choices {
  display: flex; gap: 14px; flex-wrap: wrap;
  padding: 12px 16px;
}
.choices label {
  display: inline-flex; gap: 6px; align-items: center;
  color: var(--fg-2); font-size: 12px;
  cursor: pointer;
}
.choices input { accent-color: var(--brand); }

.state-dir {
  display: block;
  margin: 12px 16px;
  padding: 8px 12px;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  font-family: var(--font-mono); font-size: 11.5px;
  color: var(--fg-2);
}
</style>
