<script setup lang="ts">
import { computed, inject, ref, toRef } from "vue";
import { useRoute } from "vue-router";
import { useSessionDetailQuery, useShareSessionMutation } from "@/queries";
import { renderMarkdown } from "@/utils/markdown";
import { APP_SHELL_KEY } from "@/shell";
import type { MessageBlock, Session } from "@/types";

const shell = inject(APP_SHELL_KEY);
const route = useRoute();

const props = defineProps<{ id: string }>();

const { data, isPending, isError, error, refetch } = useSessionDetailQuery(toRef(props, "id"));

const session = computed<Session | null>(() => data.value?.session ?? null);
const messages = computed(() => data.value?.messages ?? []);

interface ErrorInfo {
  status: string;
  requestPath: string;
  message: string;
}

const errorInfo = computed<ErrorInfo>(() => {
  const message = error.value?.message ?? "Unknown error";
  const m = message.match(/^(\d{3})\s+([^—]+?)\s+—\s+(.+)$/);
  if (m) {
    const [, code = "", statusText = "", requestPath = ""] = m;
    return {
      status: `${code} ${statusText.trim()}`,
      requestPath: requestPath.trim(),
      message,
    };
  }
  return { status: "Network / client error", requestPath: "", message };
});
const errorKind = computed<"missing" | "other">(() =>
  errorInfo.value.status.startsWith("404") ? "missing" : "other",
);

// ---- Share / Copy actions (I-05) ---------------------------------------
const shareMutation = useShareSessionMutation();
const toast = ref<{ msg: string; tone: "ok" | "err" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function flashToast(msg: string, tone: "ok" | "err" = "ok") {
  toast.value = { msg, tone };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2200);
}

async function onCopyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    flashToast("Link copied");
  } catch {
    window.prompt("Copy link", window.location.href);
  }
}

async function onShare() {
  if (!session.value) return;
  try {
    const result = await shareMutation.mutateAsync(session.value.id);
    try {
      await navigator.clipboard.writeText(result.url);
      flashToast("Shared · URL copied");
    } catch {
      flashToast(`Shared: ${result.url}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    flashToast(msg.includes("WHAT7_WORKER_URL") ? "Worker not configured" : `Share failed: ${msg}`, "err");
  }
}

const listPath = computed<string>(() => {
  const meta = route.meta as { kind?: string };
  const slug = String(route.params.slug ?? "");
  if (meta?.kind === "project") return `/p/${slug}`;
  if (meta?.kind === "search") {
    const qs = new URLSearchParams(route.query as Record<string, string>).toString();
    return `/search${qs ? `?${qs}` : ""}`;
  }
  if (meta?.kind === "published") {
    const qs = new URLSearchParams(route.query as Record<string, string>).toString();
    return `/published${qs ? `?${qs}` : ""}`;
  }
  if (meta?.kind === "session") return "/recent";
  return "/recent";
});

function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function headLine(s: Session): string {
  const time = formatTime(s.endedAt ?? s.startedAt);
  const parts: string[] = [s.project, `${s.messageCount} msgs`];
  if (s.model) parts.push(s.model);
  if (time) parts.push(time);
  return parts.join(" · ");
}

function msgRoleLabel(m: MessageBlock): string {
  if (m.role) return m.role;
  return m.kind;
}

function msgRoleClass(m: MessageBlock): string {
  return `msg-${m.role ?? m.kind}`;
}
</script>

<template>
  <article v-if="session" class="reader">
    <header class="head">
      <div class="title-row">
        <RouterLink
          v-if="shell?.isMobile.value"
          class="back"
          :to="listPath"
          aria-label="Back to list"
        >‹</RouterLink>
        <h1 v-text="session.title"></h1>
        <div class="actions">
          <button class="ghost" @click="onCopyLink">Copy link</button>
          <button class="primary" :disabled="shareMutation.isPending.value" @click="onShare">
            <span v-if="shareMutation.isPending.value">Sharing…</span>
            <span v-else>Share</span>
          </button>
        </div>
      </div>
      <div class="meta">
        <span v-text="headLine(session)"></span>
      </div>
    </header>
    <div class="body">
      <div v-for="m in messages" :key="m.id" :class="['msg', msgRoleClass(m)]">
        <div class="role">
          <span v-text="msgRoleLabel(m)"></span>
          <span v-if="m.toolName" class="tool-name" v-text="m.toolName"></span>
        </div>
        <div class="content" v-html="renderMarkdown(m.content)"></div>
      </div>
      <div v-if="!messages.length" class="empty-card">
        <h2>No indexed messages</h2>
        <p>
          This session exists, but cxs returned zero message rows. Check the
          source transcript if the pane looks unexpectedly empty.
        </p>
        <code v-text="session.sourcePath"></code>
      </div>
    </div>
    <div v-if="toast" :class="['toast', `tone-${toast.tone}`]" v-text="toast.msg"></div>
  </article>
  <div v-else-if="isPending" class="missing">Loading…</div>
  <div v-else-if="isError" class="missing">
    <div class="err-card">
      <h2 v-if="errorKind === 'missing'">Session not found</h2>
      <h2 v-else>Failed to load</h2>
      <p v-if="errorKind === 'missing'">
        <code v-text="props.id"></code> no longer exists in the cxs index.
        Try <kbd>cxs sync</kbd> if you expect it to be there.
      </p>
      <p v-else>
        <code v-text="errorInfo.message"></code>
      </p>
      <dl>
        <div>
          <dt>Status</dt>
          <dd v-text="errorInfo.status"></dd>
        </div>
        <div v-if="errorInfo.requestPath">
          <dt>Request</dt>
          <dd><code v-text="errorInfo.requestPath"></code></dd>
        </div>
      </dl>
      <button class="retry" @click="refetch()">Retry</button>
    </div>
  </div>
  <div v-else class="missing">
    Session <code v-text="props.id"></code> not found.
  </div>
</template>

<style scoped>
.reader {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--bg);
  position: relative;
}
.head {
  position: sticky; top: 0;
  padding: 16px 28px 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  z-index: 1;
}
.title-row { display: flex; align-items: flex-start; gap: 16px; }
.title-row .back {
  display: grid; place-items: center;
  width: 30px; height: 30px;
  border-radius: var(--r-sm);
  color: var(--fg-2);
  font-size: 22px; line-height: 1;
  margin-top: -2px;
  flex: 0 0 auto;
}
.title-row .back:hover { background: var(--surface-2); color: var(--fg); }
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
.actions .primary:hover { background: var(--brand-soft-hover); }
.meta {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin-top: 8px;
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3);
}

.body {
  overflow-y: auto;
  padding: 24px 28px 80px;
  display: flex; flex-direction: column; gap: 22px;
  max-width: 880px;
}
.body .empty-card {
  max-width: 520px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--fg-2);
}
.body .empty-card h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
.body .empty-card p {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.5;
}
.body .empty-card code {
  display: block;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
  background: var(--surface-2);
  padding: 6px 8px;
  border-radius: var(--r-sm);
}
.msg .role {
  display: flex; gap: 8px;
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.msg .role .tool-name { color: var(--accent); text-transform: none; }
.msg .content {
  font-size: 13.5px; line-height: 1.65;
  color: var(--fg);
}
.msg .content > :first-child { margin-top: 0; }
.msg .content > :last-child { margin-bottom: 0; }
.msg .content p { margin: 0 0 10px; }
.msg .content strong { font-weight: 600; }
.msg .content em { font-style: italic; }
.msg .content del { text-decoration: line-through; color: var(--fg-3); }
.msg .content a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.msg .content a:hover { text-decoration-thickness: 2px; }
.msg .content h1, .msg .content h2, .msg .content h3,
.msg .content h4, .msg .content h5, .msg .content h6 {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--fg);
}
.msg .content h1 { font-size: 18px; }
.msg .content h2 { font-size: 16px; }
.msg .content h3 { font-size: 14.5px; }
.msg .content h4, .msg .content h5, .msg .content h6 { font-size: 13.5px; }
.msg .content ul, .msg .content ol {
  margin: 0 0 10px; padding-left: 22px;
}
.msg .content li { margin: 3px 0; }
.msg .content li > p { margin: 0 0 4px; }
.msg .content blockquote {
  margin: 0 0 10px; padding: 4px 12px;
  border-left: 3px solid var(--line-strong);
  color: var(--fg-2);
}
.msg .content hr {
  border: 0; border-top: 1px solid var(--line);
  margin: 16px 0;
}
.msg .content code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px 5px;
}
.msg .content pre {
  margin: 0 0 10px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow-x: auto;
  font-size: 12px; line-height: 1.55;
}
.msg .content pre code {
  background: transparent;
  border: 0;
  padding: 0;
  font-size: inherit;
}
.msg .content table {
  border-collapse: collapse;
  margin: 0 0 10px;
  font-size: 12.5px;
}
.msg .content th, .msg .content td {
  border: 1px solid var(--line);
  padding: 4px 8px; text-align: left;
}
.msg .content th { background: var(--surface); font-weight: 600; }
.msg .content img { max-width: 100%; border-radius: var(--r-sm); }
.msg .content kbd {
  font-family: var(--font-mono); font-size: 11px;
  border: 1px solid var(--line-strong);
  border-radius: 3px; padding: 1px 5px;
  background: var(--surface-2); color: var(--fg);
}
.msg-tool .content,
.msg-tool_call .content,
.msg-tool_result .content {
  font-family: var(--font-mono); font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  color: var(--fg-2);
  white-space: pre-wrap;
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
.err-card {
  max-width: 380px;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--fg-2);
  font-family: var(--font-sans);
  text-align: left;
}
.err-card h2 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.err-card p {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.5;
}
.err-card dl {
  display: grid;
  gap: 6px;
  margin: 0 0 14px;
}
.err-card dl div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
}
.err-card dt {
  color: var(--fg-3);
  font-size: 11px;
}
.err-card dd {
  margin: 0;
  font-size: 11.5px;
}
.err-card code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
}
.err-card kbd {
  font-family: var(--font-mono);
  font-size: 11.5px;
  border: 1px solid var(--line);
  padding: 1px 5px;
  border-radius: 3px;
}
.err-card .retry {
  padding: 5px 12px;
  font-size: 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  color: var(--fg);
}
.err-card .retry:hover { background: var(--surface-2); }

.actions button[disabled] { opacity: 0.6; cursor: wait; }

.toast {
  position: absolute; right: 28px; bottom: 28px;
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  color: var(--fg);
  font-size: 12.5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  animation: toast-fade-in 140ms ease-out;
  z-index: 20;
}
.toast.tone-err {
  border-color: #e66;
  color: #fbb;
}
@keyframes toast-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
