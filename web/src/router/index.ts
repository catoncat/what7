import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ReadingEmpty from "@/views/ReadingEmpty.vue";
import ReadingPane from "@/views/ReadingPane.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      { path: "", redirect: { name: "inbox" } },
      {
        path: "inbox",
        name: "inbox",
        components: { reading: ReadingEmpty },
        props: { reading: () => ({ kind: "inbox" }) },
        meta: { kind: "inbox" },
      },
      {
        path: "inbox/:id",
        name: "inbox.session",
        components: { reading: ReadingPane },
        props: { reading: true },
        meta: { kind: "inbox" },
      },
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
    ],
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
