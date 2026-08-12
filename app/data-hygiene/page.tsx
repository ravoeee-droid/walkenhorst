"use client";

import { AuthGate } from "@/components/auth-gate";
import { DataHygieneCenter } from "@/components/data-hygiene-center";

export default function DataHygienePage(){
  return <AuthGate>{user=><DataHygieneCenter user={user}/>}</AuthGate>;
}
