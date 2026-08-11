"use client";

import { AuthGate } from "@/components/auth-gate";
import { SalesOsDashboard } from "@/components/sales-os-dashboard";

export function AppShell() {
  return <AuthGate>{(user) => <SalesOsDashboard user={user} />}</AuthGate>;
}
