"use client";

import { useAppUser } from "@/components/app-user-context";
import { SalesOsDashboardV2 } from "@/components/sales-os-dashboard-v2";

export function AppShell() {
  const user = useAppUser();
  return <SalesOsDashboardV2 user={user} />;
}
