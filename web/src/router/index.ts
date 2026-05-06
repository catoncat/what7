import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ReadingEmpty from "@/views/ReadingEmpty.vue";
import ReadingPane from "@/views/ReadingPane.vue";

const SCOPES = ["inbox", "pinned", "shared", "drafts"] as const;

const scopeRoutes: RouteRecordRaw[] = SCOPES.flatMap((scope) => [
  {
    path: scope,
    name: scope,
    components: { reading: ReadingEmpty },
    props: { reading: () => ({ kind: "scope", scope }) },
    meta: { kind: "scope", scope },
  },
  {
    path: `${scope}/:id`,
    name: `${scope}.session`,
    components: { reading: ReadingPane },
    props: { reading: true },
    meta: { kind: "scope", scope },
  },
]);

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      component: AppLayout,
      children: [
        { path: "", redirect: { name: "inbox" } },
        ...scopeRoutes,
        {
          path: "projects/:slug",
          name: "project",
          components: { reading: ReadingEmpty },
          props: { reading: (route) => ({ kind: "project", slug: route.params.slug }) },
          meta: { kind: "project" },
        },
        {
          path: "projects/:slug/:id",
          name: "project.session",
          components: { reading: ReadingPane },
          props: { reading: true },
          meta: { kind: "project" },
        },
        {
          path: "agents/:slug",
          name: "agent",
          components: { reading: ReadingEmpty },
          props: { reading: (route) => ({ kind: "agent", slug: route.params.slug }) },
          meta: { kind: "agent" },
        },
        {
          path: "agents/:slug/:id",
          name: "agent.session",
          components: { reading: ReadingPane },
          props: { reading: true },
          meta: { kind: "agent" },
        },
      ],
    },
  ],
});

export default router;
