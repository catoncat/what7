<script setup lang="ts">
import { computed, inject } from "vue";
import { RouterLink } from "vue-router";
import { APP_SHELL_KEY } from "@/shell";
import type { Session } from "@/types";

const shell = inject(APP_SHELL_KEY);

const props = defineProps<{
  title: string;
  sessions: Session[];
  activeId: string | undefined;
  loading: boolean;
  buildLink: (id: string) => string;
}>();

interface Bucket { label: string; items: Session[]; }

function sortKey(s: Session): number {
  const t = s.endedAt ?? s.startedAt ?? s.updatedAt;
  return t ? new Date(t).getTime() : 0;
}

const buckets = computed<Bucket[]>(() => {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const today: Session[] = [];
  const yesterday: Session[] = [];
  const thisWeek: Session[] = [];
  const earlier: Session[] = [];
  for (const s of props.sessions) {
    const t = sortKey(s);
    if (t >= startOfToday.getTime()) today.push(s);
    else if (t >= startOfYesterday.getTime()) yesterday.push(s);
    else if (t >= startOfWeek.getTime()) thisWeek.push(s);
    else earlier.push(s);
  }
  const groups: Bucket[] = [
    { label: "Today", items: today },
    { label: "Yesterday", items: yesterday },
    { label: "This week", items: thisWeek },
    { label: "Earlier", items: earlier },
  ];
  return groups.filter((b) => b.items.length);
});

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function metaLine(s: Session): string {
  const parts: string[] = [s.project, `${s.messageCount} msgs`];
  if (s.model) parts.push(s.model);
  return parts.join(" · ");
}
</script>

<template>
  <section class="list">
    <header>
      <button
        v-if="shell?.isMobile.value"
        class="menu"
        aria-label="Open navigation"
        @click="shell?.openNav()"
      >☰</button>
      <h2 v-text="title"></h2>
      <span class="count" v-text="sessions.length"></span>
    </header>
    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!sessions.length" class="empty">No sessions in this view.</div>
    <div v-for="b in buckets" :key="b.label" class="bucket">
      <h3 v-text="b.label"></h3>
      <RouterLink
        v-for="s in b.items"
        :key="s.id"
        :to="buildLink(s.id)"
        class="row"
        :class="{ active: s.id === activeId }"
      >
        <div class="body">
          <div class="title" v-text="s.title"></div>
          <div class="meta">
            <span v-text="metaLine(s)"></span>
          </div>
        </div>
        <span class="time" v-text="relativeTime(s.endedAt ?? s.startedAt)"></span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.list {
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex; flex-direction: column;
  overflow-y: auto;
}
.list > header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px 10px;
  position: sticky; top: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  z-index: 1;
}
.list > header .menu {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 16px;
}
.list > header .menu:hover { background: var(--surface-2); color: var(--fg); }
.list h2 { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--fg); }
.list .count {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--fg-3);
  background: var(--surface-2);
  border-radius: 999px; padding: 1px 7px;
}
.empty { color: var(--fg-3); padding: 20px 16px; font-size: 12.5px; }

.bucket h3 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--fg-3); font-weight: 500;
  margin: 0; padding: 10px 16px 6px;
  position: sticky; top: 41px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  border-left: 2px solid transparent;
  color: var(--fg-2);
}
.row:hover { background: var(--surface-2); color: var(--fg); }
.row.active {
  background: var(--surface-2); color: var(--fg);
  border-left-color: var(--accent);
}
.row .body { flex: 1; min-width: 0; }
.row .title {
  color: var(--fg);
  font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row .meta {
  display: flex; gap: 6px; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3);
  margin-top: 3px;
  align-items: center;
}
.row .time {
  color: var(--fg-3);
  font-family: var(--font-mono); font-size: 10.5px;
  flex: 0 0 auto;
}
</style>
