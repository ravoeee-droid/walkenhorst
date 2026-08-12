"use client";

import { AuthGate } from "@/components/auth-gate";
import { RevenueAnalytics } from "@/components/revenue-analytics";

export default function AnalyticsPage(){
  return <AuthGate>{user=><RevenueAnalytics user={user}/>}</AuthGate>;
}
