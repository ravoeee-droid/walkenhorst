"use client";

import { AuthGate } from "@/components/auth-gate";
import { RuntimeSettingsCenter } from "@/components/runtime-settings-center";

export default function SettingsPage(){
  return <AuthGate>{user=><RuntimeSettingsCenter user={user}/>}</AuthGate>;
}
