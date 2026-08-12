"use client";

import { AuthGate } from "@/components/auth-gate";
import { PvIntelligenceCenter } from "@/components/pv-intelligence-center";

export default function PvIntelligencePage(){
  return <AuthGate>{user=><PvIntelligenceCenter user={user}/>}</AuthGate>;
}
