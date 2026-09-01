"use client";

import { AuthGate } from "@/components/auth-gate";
import { VideoFunnelAnalytics } from "@/components/video-funnel-analytics";

export default function EngagementPage(){
  return <AuthGate>{user=><VideoFunnelAnalytics user={user}/>}</AuthGate>;
}
