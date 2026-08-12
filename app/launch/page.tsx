"use client";

import { AuthGate } from "@/components/auth-gate";
import { GoLiveCenter } from "@/components/go-live-center";

export default function LaunchPage(){
  return <AuthGate>{user=><GoLiveCenter user={user}/>}</AuthGate>;
}
