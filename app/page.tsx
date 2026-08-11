import { AuthGate } from "@/components/auth-gate";
import { EnergyRadarApp } from "@/components/energy-radar-app";

export default function HomePage() {
  return <AuthGate>{(user) => <EnergyRadarApp user={user} />}</AuthGate>;
}
