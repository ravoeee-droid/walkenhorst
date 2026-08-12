"use client";

import { AuthGate } from "@/components/auth-gate";
import { DeliverabilityCenter } from "@/components/deliverability-center";

export default function DeliverabilityPage(){
  return <AuthGate>{user=><DeliverabilityCenter user={user}/>}</AuthGate>;
}
