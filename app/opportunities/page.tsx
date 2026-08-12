"use client";

import { AuthGate } from "@/components/auth-gate";
import { OpportunityCenter } from "@/components/opportunity-center";

export default function OpportunitiesPage(){
  return <AuthGate>{user=><OpportunityCenter user={user}/>}</AuthGate>;
}
