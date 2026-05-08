<script setup lang="ts">
defineProps<{ title: string; hint: string }>();
</script>

<template>
  <div class="placeholder">
    <div class="card">
      <h1 v-text="title"></h1>
      <p v-text="hint"></p>
    </div>
  </div>
</template>

<style scoped>
.placeholder {
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
.card p {
  margin: 0;
  font-family: var(--font-mono); font-size: 12px;
  color: var(--fg-3);
  line-height: 1.6;
}
</style>
