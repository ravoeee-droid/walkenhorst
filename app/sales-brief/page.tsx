"use client";

import { AuthGate } from "@/components/auth-gate";
import { SalesBriefCenter } from "@/components/sales-brief-center";

export default function SalesBriefPage(){
  return <AuthGate>{user=><SalesBriefCenter user={user}/>}</AuthGate>;
}
