"use client";

import { AuthGate } from "@/components/auth-gate";
import { AdvancedIntegrations } from "@/components/advanced-integrations";
import { ChatwootLeadSync } from "@/components/chatwoot-lead-sync";

export default function IntegrationsPage(){
  return <AuthGate>{user=><><AdvancedIntegrations user={user}/><div style={{maxWidth:1480,margin:"-36px auto 80px",padding:"0 26px"}}><ChatwootLeadSync user={user}/></div></>}</AuthGate>;
}
