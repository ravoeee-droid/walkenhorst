"use client";

import { AuthGate } from "@/components/auth-gate";
import { OutboundDashboard } from "@/components/outbound-dashboard";

export function AppShell() {
  return <AuthGate>{(user) => <OutboundDashboard user={user} />}</AuthGate>;
}
