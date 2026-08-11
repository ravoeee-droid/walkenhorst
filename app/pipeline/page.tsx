"use client";

import { AuthGate } from "@/components/auth-gate";
import { CrmPipeline } from "@/components/crm-pipeline";

export default function PipelinePage(){
  return <AuthGate>{user=><CrmPipeline user={user}/>}</AuthGate>;
}
