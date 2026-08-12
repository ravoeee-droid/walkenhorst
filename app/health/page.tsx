"use client";

import { AuthGate } from "@/components/auth-gate";
import { SystemHealthCenter } from "@/components/system-health-center";

export default function HealthPage(){
  return <AuthGate>{user=><SystemHealthCenter user={user}/>}</AuthGate>;
}
