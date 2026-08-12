"use client";

import { AuthGate } from "@/components/auth-gate";
import { SystemHealthCenterV2 } from "@/components/system-health-center-v2";

export default function HealthV2Page(){
  return <AuthGate>{user=><SystemHealthCenterV2 user={user}/>}</AuthGate>;
}
