"use client";

import { AuthGate } from "@/components/auth-gate";
import { LeadPrepCenter } from "@/components/lead-prep-center";

export default function PrepPage(){
  return <AuthGate>{user=><LeadPrepCenter user={user}/>}</AuthGate>;
}
