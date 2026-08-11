import type { Metadata } from "next";
import "./globals.css";
import "./outbound-ui.css";

export const metadata: Metadata = {
  title: "Walkenhorst Energy Sales Radar",
  description: "Lead Intelligence, Energy Opportunity Scoring und personalisierter Outbound für Walkenhorst.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
