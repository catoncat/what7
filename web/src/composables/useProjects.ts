import { computed } from "vue";
import { useProjectsQuery, useUpdateProjectMutation } from "@/queries";
import type { Project } from "@/types";

/**
 * Thin composable over vue-query. Preserves the previous API shape
 * (`projects` readonly ref + `refresh` + `patch`) so existing consumers
 * keep working, but all caching / refetch / invalidation now goes through
 * the QueryClient.
 */
export function useProjects() {
  const query = useProjectsQuery();
  const mutation = useUpdateProjectMutation();

  const projects = computed<Project[]>(() => query.data.value ?? []);

  async function refresh(): Promise<void> {
    await query.refetch();
  }

  async function patch(
    slug: string,
    input: { displayName?: string | null; hidden?: boolean },
  ): Promise<Project> {
    return mutation.mutateAsync({ slug, patch: input });
  }

  return {
    projects,
    loaded: computed(() => query.isSuccess.value),
    loading: computed(() => query.isFetching.value),
    refresh,
    patch,
  };
}
