"use client";

import { AuthGate } from "@/components/auth-gate";
import { DailyCommandCenter } from "@/components/daily-command-center";

export default function CommandPage(){
  return <AuthGate>{user=><DailyCommandCenter user={user}/>}</AuthGate>;
}
