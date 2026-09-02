"use client";

import { AuthGate } from "@/components/auth-gate";
import { CampaignLab } from "@/components/campaign-lab";

export default function AdvancedCampaignLabPage() {
  return <AuthGate>{(user) => <CampaignLab user={user} />}</AuthGate>;
}
