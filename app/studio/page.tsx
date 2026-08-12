"use client";

import { AuthGate } from "@/components/auth-gate";
import { EnergyVideoStudio } from "@/components/energy-video-studio";

export default function StudioPage(){
  return <AuthGate>{user=><EnergyVideoStudio user={user}/>}</AuthGate>;
}
