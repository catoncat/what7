import type { InjectionKey, Ref } from "vue";
import type { Session } from "@/types";

export interface AppShell {
  isMobile: Ref<boolean>;
  navOpen: Ref<boolean>;
  openNav: () => void;
  closeNav: () => void;
}

export const APP_SHELL_KEY: InjectionKey<AppShell> = Symbol("AppShell");

export const CURRENT_SESSION_KEY: InjectionKey<Readonly<Ref<Session | null>>> =
  Symbol("CurrentSession");
