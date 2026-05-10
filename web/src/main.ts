import "./assets/main.css";

import { createApp } from "vue";
import { VueQueryPlugin, type VueQueryPluginOptions } from "@tanstack/vue-query";
import App from "./App.vue";
import router from "./router";

const vueQueryOptions: VueQueryPluginOptions = {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  },
};

createApp(App).use(router).use(VueQueryPlugin, vueQueryOptions).mount("#app");
