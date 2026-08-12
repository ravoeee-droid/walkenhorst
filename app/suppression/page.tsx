"use client";

import { AuthGate } from "@/components/auth-gate";
import { SuppressionCenter } from "@/components/suppression-center";

export default function SuppressionPage(){
  return <AuthGate>{user=><SuppressionCenter user={user}/>}</AuthGate>;
}
