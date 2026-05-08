import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ReadingEmpty from "@/views/ReadingEmpty.vue";
import ReadingPane from "@/views/ReadingPane.vue";

function resolveDefaultLanding(): string {
  if (typeof window === "undefined") return "/recent";
  const choice = window.localStorage.getItem("what7-default-landing");
  if (choice === "last-active") {
    const slug = window.localStorage.getItem("what7-last-active-slug");
    if (slug) return `/p/${encodeURIComponent(slug)}`;
  }
  return "/recent";
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", redirect: () => resolveDefaultLanding() },
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
        components: { reading: ReadingEmpty },
        props: { reading: () => ({ kind: "search" }) },
        meta: { kind: "search" },
      },
      {
        path: "search/:id",
        name: "search.session",
        components: { reading: ReadingPane },
        props: { reading: true },
        meta: { kind: "search" },
      },
      {
        path: "published",
        name: "published",
        components: { reading: ReadingEmpty },
        props: { reading: () => ({ kind: "published" }) },
        meta: { kind: "published" },
      },
      {
        path: "published/:id",
        name: "published.session",
        components: { reading: ReadingPane },
        props: { reading: true },
        meta: { kind: "published" },
      },
      {
        path: "settings",
        name: "settings",
        components: { reading: ReadingEmpty },
        props: { reading: () => ({ kind: "settings" }) },
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
