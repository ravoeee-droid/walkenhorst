"use client";

import { AuthGate } from "@/components/auth-gate";
import { EnergyRadarApp } from "@/components/energy-radar-app";

export function AppShell() {
  return <AuthGate>{(user) => <EnergyRadarApp user={user} />}</AuthGate>;
}
