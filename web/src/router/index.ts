import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ReadingEmpty from "@/views/ReadingEmpty.vue";
import ReadingPane from "@/views/ReadingPane.vue";
import PlaceholderPane from "@/views/PlaceholderPane.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", redirect: { name: "recent" } },
      {
        path: "recent",
        name: "recent",
        components: { reading: ReadingEmpty },
        props: { reading: () => ({ kind: "recent" }) },
        meta: { kind: "recent" },
      },
      {
        path: "recent/:id",
        name: "recent.session",
        components: { reading: ReadingPane },
        props: { reading: true },
        meta: { kind: "recent" },
      },
      {
        path: "p/:slug",
        name: "project",
        components: { reading: ReadingEmpty },
        props: { reading: (route) => ({ kind: "project", slug: route.params.slug }) },
        meta: { kind: "project" },
      },
      {
        path: "p/:slug/:id",
        name: "project.session",
        components: { reading: ReadingPane },
        props: { reading: true },
        meta: { kind: "project" },
      },
      {
        path: "s/:id",
        name: "session",
        components: { reading: ReadingPane },
        props: { reading: true },
        meta: { kind: "session" },
      },
      {
        path: "search",
        name: "search",
        components: { reading: PlaceholderPane },
        props: { reading: () => ({ title: "Search", hint: "Coming in M4.2 — filter chip bar + session-level hits." }) },
        meta: { kind: "search" },
      },
      {
        path: "published",
        name: "published",
        components: { reading: PlaceholderPane },
        props: { reading: () => ({ title: "Published", hint: "Alias for /recent?shared=1. Wires up alongside search in M4." }) },
        meta: { kind: "published" },
      },
      {
        path: "settings",
        name: "settings",
        components: { reading: PlaceholderPane },
        props: { reading: () => ({ title: "Settings", hint: "Project aliases + default landing land in M4.3." }) },
        meta: { kind: "settings" },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
