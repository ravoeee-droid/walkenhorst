import type { Metadata } from "next";
import { ApplicationFrame } from "@/components/application-frame";
import "./globals.css";
import "./outbound-ui.css";
import "./sales-os.css";
import "./apple-shell.css";
import "./premium-glass.css";
import "./studio-ux-polish.css";
import "./design-system.css";
import "./lead-production-state.css";

export const metadata: Metadata = {
  title: "Walkenhorst Energy Sales OS",
  description: "Revenue Intelligence, Outbound, Studio V3 und Sales CRM für Walkenhorst in einem System.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body><ApplicationFrame>{children}</ApplicationFrame></body></html>;
}
