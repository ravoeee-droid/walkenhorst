"use client";

import { AuthGate } from "@/components/auth-gate";
import { AuditPdfButton } from "@/components/audit-pdf-button";
import { SalesOSDashboard } from "@/components/sales-os-dashboard";

export function AppShell() {
  return <AuthGate>{(user) => <><SalesOSDashboard user={user} /><AuditPdfButton /></>}</AuthGate>;
}
