"use client";

import { AuthGate } from "@/components/auth-gate";
import { SalesOsDashboardV2 } from "@/components/sales-os-dashboard-v2";
import { SystemModuleLinks } from "@/components/system-module-links";

export function AppShell() {
  return <AuthGate>{(user) => <><SalesOsDashboardV2 user={user} /><SystemModuleLinks /></>}</AuthGate>;
}
