"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

const AppUserContext = createContext<User | null>(null);

export function AppUserProvider({ user, children }: { user: User; children: ReactNode }) {
  return <AppUserContext.Provider value={user}>{children}</AppUserContext.Provider>;
}

export function useAppUser() {
  const user = useContext(AppUserContext);
  if (!user) throw new Error("App user context is unavailable outside the authenticated application frame.");
  return user;
}
