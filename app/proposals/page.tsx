"use client";

import { AuthGate } from "@/components/auth-gate";
import { ProposalCenter } from "@/components/proposal-center";

export default function ProposalsPage(){
  return <AuthGate>{user=><ProposalCenter user={user}/>}</AuthGate>;
}
