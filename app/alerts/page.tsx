"use client";

import { AuthGate } from "@/components/auth-gate";
import { AlertCenter } from "@/components/alert-center";

export default function AlertsPage(){
  return <AuthGate>{user=><AlertCenter user={user}/>}</AuthGate>;
}
