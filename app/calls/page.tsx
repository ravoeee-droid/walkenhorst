"use client";

import { AuthGate } from "@/components/auth-gate";
import { CallerQueue } from "@/components/caller-queue";

export default function CallsPage(){
  return <AuthGate>{user=><CallerQueue user={user}/>}</AuthGate>;
}
