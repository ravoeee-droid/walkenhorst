"use client";

import { AuthGate } from "@/components/auth-gate";
import { LaunchCampaign } from "@/components/launch-campaign";

export default function CampaignLabPage() {
  return <AuthGate>{(user) => <LaunchCampaign user={user} />}</AuthGate>;
}
