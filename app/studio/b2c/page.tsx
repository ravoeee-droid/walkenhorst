"use client";

import { AuthGate } from "@/components/auth-gate";
import { StudioUploadProgress } from "@/components/studio-upload-progress";
import { StudioV3Editor } from "@/components/studio-v3/studio-v3-editor";

export default function B2CStudioPage(){
  return <>
    <AuthGate>{user=><StudioV3Editor user={user} customerType="private" defaultTemplateKey="pv-privat" studioLabel="Walkenhorst B2C Studio" templateLabel="B2C · PV Privat"/>}</AuthGate>
    <StudioUploadProgress/>
  </>;
}
