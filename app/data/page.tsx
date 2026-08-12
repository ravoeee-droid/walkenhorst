"use client";

import { AuthGate } from "@/components/auth-gate";
import { DataTransferCenter } from "@/components/data-transfer-center";

export default function DataPage(){
  return <AuthGate>{user=><DataTransferCenter user={user}/>}</AuthGate>;
}
