"use client";

import { AuthGate } from "@/components/auth-gate";
import { RevivalCenter } from "@/components/revival-center";

export default function RevivalPage(){
  return <AuthGate>{user=><RevivalCenter user={user}/>}</AuthGate>;
}
