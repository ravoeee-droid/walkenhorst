"use client";

import { AuthGate } from "@/components/auth-gate";
import { MeetingPrepCenter } from "@/components/meeting-prep-center";

export default function MeetingsPage(){
  return <AuthGate>{user=><MeetingPrepCenter user={user}/>}</AuthGate>;
}
