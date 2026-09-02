"use client";

import { AuthGate } from "@/components/auth-gate";
import { StudioUploadProgress } from "@/components/studio-upload-progress";
import { StudioV3Editor } from "@/components/studio-v3/studio-v3-editor";

export default function B2BStudioPage(){
  return <>
    <AuthGate>{user=><StudioV3Editor user={user} customerType="commercial" defaultTemplateKey="energiekosten" studioLabel="Walkenhorst B2B Studio" templateLabel="B2B · Energiekosten Loom"/>}</AuthGate>
    <StudioUploadProgress/>
  </>;
}
