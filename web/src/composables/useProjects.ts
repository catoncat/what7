import { readonly, ref } from "vue";
import { fetchProjects, updateProject } from "@/api/client";
import type { Project } from "@/types";

// Module-scoped singleton: projects list is shared across NavSidebar,
// Settings, and AppLayout. Settings updates invalidate all consumers.

const projects = ref<Project[]>([]);
const loaded = ref(false);
const loading = ref(false);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    projects.value = await fetchProjects();
    loaded.value = true;
  } finally {
    loading.value = false;
  }
}

async function patch(slug: string, input: { displayName?: string | null; hidden?: boolean }): Promise<Project> {
  const next = await updateProject(slug, input);
  projects.value = projects.value.map((p) => (p.slug === slug ? next : p));
  return next;
}

export function useProjects() {
  return {
    projects: readonly(projects),
    loaded: readonly(loaded),
    loading: readonly(loading),
    refresh,
    patch,
  };
}
