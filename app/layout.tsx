import type { Metadata } from "next";
import "./globals.css";
import "./outbound-ui.css";
import "./sales-os.css";
import "./audit-print.css";
import "./video-preview.css";

export const metadata: Metadata = {
  title: "Walkenhorst Energy Sales OS",
  description: "Lead Finder, personalisierte Outbound-Kampagnen, Fake-Loom und Sales CRM für Walkenhorst.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
