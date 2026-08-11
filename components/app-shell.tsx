"use client";

import { AuthGate } from "@/components/auth-gate";
import { SalesOSDashboard } from "@/components/sales-os-dashboard";

export function AppShell() {
  return <AuthGate>{(user) => <SalesOSDashboard user={user} />}</AuthGate>;
}
