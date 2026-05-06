<script setup lang="ts">
import { computed } from "vue";
import { detail } from "@/data/mock";

const props = defineProps<{ id: string }>();
const sessionDetail = computed(() => detail(props.id));

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function headLine(s: NonNullable<ReturnType<typeof detail>>): string {
  return `${s.id} · ${s.project} · ${s.agent} · ${s.messageCount} msgs · ${s.toolCount} tools · ${formatTime(s.startedAt)}`;
}
</script>

<template>
  <article v-if="sessionDetail" class="reader">
    <header class="head">
      <div class="title-row">
        <h1 v-text="sessionDetail.title"></h1>
        <div class="actions">
          <button class="ghost">Copy link</button>
          <button class="primary">Share</button>
        </div>
      </div>
      <div class="meta">
        <span v-text="headLine(sessionDetail)"></span>
        <span v-if="sessionDetail.shared" class="tag tag-shared">shared</span>
        <span v-if="sessionDetail.draft" class="tag tag-draft">draft</span>
        <span v-if="sessionDetail.pinned" class="tag tag-pinned">pinned</span>
      </div>
    </header>
    <div class="body">
      <div v-for="m in sessionDetail.messages" :key="m.id" :class="['msg', `msg-${m.role}`]">
        <div class="role">
          <span v-text="m.role"></span>
          <span v-if="m.meta" class="tool-name" v-text="m.meta"></span>
        </div>
        <div class="content" v-text="m.content"></div>
      </div>
    </div>
  </article>
  <div v-else class="missing">
    Session <code v-text="id"></code> not found in mock data.
  </div>
</template>

<style scoped>
.reader {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--bg);
}
.head {
  position: sticky; top: 0;
  padding: 16px 28px 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  z-index: 1;
}
.title-row { display: flex; align-items: flex-start; gap: 16px; }
.head h1 {
  flex: 1; margin: 0;
  font-size: 17px; font-weight: 600; color: var(--fg);
}
.actions { display: flex; gap: 6px; }
.actions button {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  color: var(--fg-2);
}
.actions .ghost:hover { color: var(--fg); border-color: var(--line-strong); }
.actions .primary {
  background: var(--brand-soft);
  color: var(--brand);
  border-color: transparent;
}
.actions .primary:hover { background: rgba(201,98,45,0.24); }
.meta {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin-top: 8px;
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3);
}
.meta .tag {
  font-family: var(--font-sans); font-size: 9.5px;
  padding: 0 5px; border-radius: 3px; line-height: 14px;
}
.tag-shared { color: var(--green); background: rgba(95,184,142,0.12); }
.tag-draft { color: var(--amber); background: rgba(214,164,90,0.12); }
.tag-pinned { color: var(--brand); background: var(--brand-soft); }

.body {
  overflow-y: auto;
  padding: 24px 28px 80px;
  display: flex; flex-direction: column; gap: 22px;
  max-width: 880px;
}
.msg .role {
  display: flex; gap: 8px;
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.msg .role .tool-name { color: var(--accent); text-transform: none; }
.msg .content {
  white-space: pre-wrap;
  font-size: 13.5px; line-height: 1.65;
  color: var(--fg);
}
.msg-tool .content {
  font-family: var(--font-mono); font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  color: var(--fg-2);
}
.msg-reasoning .content {
  color: var(--fg-3);
  font-style: italic;
  font-size: 12.5px;
}
.missing {
  flex: 1;
  display: grid; place-items: center;
  color: var(--fg-3);
  font-family: var(--font-mono);
}
</style>
