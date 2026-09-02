"use client";

import { AuthGate } from "@/components/auth-gate";
import { StudioUploadProgress } from "@/components/studio-upload-progress";
import { StudioV3Editor } from "@/components/studio-v3/studio-v3-editor";

export default function B2BStudioPage(){
  return <>
    <AuthGate>{user=>{
      const ownerId=typeof user.app_metadata?.workspace_owner_id==="string"&&user.app_metadata.workspace_owner_id.trim()?user.app_metadata.workspace_owner_id.trim():user.id;
      return <StudioV3Editor user={{...user,id:ownerId}} customerType="commercial" defaultTemplateKey="energiekosten" studioLabel="Walkenhorst B2B Studio" templateLabel="B2B · Energiekosten Loom"/>;
    }}</AuthGate>
    <StudioUploadProgress/>
  </>;
}
