"use client";

import { AuthGate } from "@/components/auth-gate";
import { EnergyVideoStudio } from "@/components/energy-video-studio";
import { StudioUploadProgress } from "@/components/studio-upload-progress";

export default function StudioPage(){
  return <><AuthGate>{user=><EnergyVideoStudio user={user}/>}</AuthGate><StudioUploadProgress/></>;
}
