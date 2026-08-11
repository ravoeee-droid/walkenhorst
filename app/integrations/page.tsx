"use client";

import { AuthGate } from "@/components/auth-gate";
import { AdvancedIntegrations } from "@/components/advanced-integrations";

export default function IntegrationsPage(){
  return <AuthGate>{user=><AdvancedIntegrations user={user}/>}</AuthGate>;
}
