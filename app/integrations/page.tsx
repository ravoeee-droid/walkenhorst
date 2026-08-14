"use client";

import { AuthGate } from "@/components/auth-gate";
import { AdvancedIntegrations } from "@/components/advanced-integrations";
import { ChatwootLeadSync } from "@/components/chatwoot-lead-sync";
import { MailboxManager } from "@/components/mailbox-manager";

export default function IntegrationsPage(){
  return <AuthGate>{user=><><div style={{maxWidth:1480,margin:"24px auto 0",padding:"0 26px"}}><MailboxManager user={user}/></div><AdvancedIntegrations user={user}/><div style={{maxWidth:1480,margin:"-36px auto 80px",padding:"0 26px"}}><ChatwootLeadSync user={user}/></div></>}</AuthGate>;
}
