"use client";

import { AuthGate } from "@/components/auth-gate";
import { StudioUploadProgress } from "@/components/studio-upload-progress";
import { StudioV3Editor } from "@/components/studio-v3/studio-v3-editor";

export default function StudioPage(){return <><AuthGate>{user=><StudioV3Editor user={user}/>}</AuthGate><StudioUploadProgress/></>}
