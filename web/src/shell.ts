import type { InjectionKey, Ref } from "vue";

export interface AppShell {
  isMobile: Ref<boolean>;
  navOpen: Ref<boolean>;
  openNav: () => void;
  closeNav: () => void;
}

export const APP_SHELL_KEY: InjectionKey<AppShell> = Symbol("AppShell");
