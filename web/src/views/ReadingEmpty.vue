<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ kind?: string; scope?: string; slug?: string }>();

const message = computed(() => {
  if (props.kind === "project") return `Pick a session in project ${props.slug}.`;
  if (props.kind === "recent") return "Pick a session on the left to start reading.";
  return "Pick a session on the left to start reading.";
});
</script>

<template>
  <div class="empty">
    <div class="card">
      <h1>what7 workbench</h1>
      <p v-text="message"></p>
      <ul>
        <li><kbd>⌘K</kbd> jump to search</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.empty {
  flex: 1;
  display: grid; place-items: center;
  background: var(--bg);
  padding: 48px;
}
.card {
  max-width: 360px;
  text-align: left;
  color: var(--fg-2);
}
.card h1 {
  margin: 0 0 8px;
  font-size: 16px; font-weight: 600;
  color: var(--fg);
}
.card p { margin: 0 0 18px; }
.card ul {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 12.5px;
}
.card kbd {
  font-family: var(--font-mono); font-size: 10.5px;
  border: 1px solid var(--line); border-radius: 3px;
  padding: 1px 5px; margin-right: 4px;
  color: var(--fg);
}
</style>
