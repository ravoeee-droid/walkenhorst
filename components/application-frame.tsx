"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/auth-gate";
import { AppUserProvider } from "@/components/app-user-context";
import { LeadRowOpenBridge } from "@/components/lead-row-open-bridge";
import { LoginPersonalizationBridge } from "@/components/login-personalization-bridge";
import { NavigationProgress } from "@/components/navigation-progress";
import { StudioLivePageBridge } from "@/components/studio-live-page-bridge";
import { RenderQueueRunner } from "@/components/crm/render-queue-runner";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type IconName = "bolt" | "search" | "send" | "inbox" | "phone" | "pipeline" | "database" | "settings" | "users" | "video";
type NavItem = { label: string; href: string; icon: IconName; section?: string };
type NavGroup = { label: string; items: NavItem[] };

const ICONS: Record<IconName, string> = {
  bolt: "m13 2-8 12h6l-1 8 9-13h-6V2Z",
  search: "M4 11a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm12 5 5 5",
  send: "m3 11 18-8-8 18-2-7-8-3Zm8 3 10-11",
  inbox: "M4 4h16v14H4V4Zm0 9h4l2 3h4l2-3h4",
  phone: "M7 3h3l2 5-2 2c1 3 3 5 6 6l2-2 5 2v3c0 2-2 3-4 3C10 21 3 14 3 5c0-2 2-2 4-2",
  pipeline: "M4 5h6v5H4V5Zm10 0h6v5h-6V5ZM9 15h6v5H9v-5Zm-2-5v3h10v-3M12 13v2",
  database: "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3Zm0 0v6c0 2 4 3 8 3s8-1 8-3V6m-16 6v6c0 2 4 3 8 3s8-1 8-3v-6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5 1 3 3 1 3-1 2 3-2 2v3l2 2-2 3-3-1-3 1-3-1-3 1-2-3 2-2v-3L3 9l2-3 3 1 3-1 1-3Z",
  users: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6m-8 7c-4 0-6 2-6 5v2h12v-2c0-3-2-5-6-5Zm8 1c3 0 5 2 5 5v1h-5",
  video: "M3 5h13v14H3V5Zm13 5 5-3v10l-5-3v-4Z",
};

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg className="wh-nav-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// TWO-WORKSPACE MODE: B2B and B2C remain visibly and technically separate.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "B2B · Gewerbe",
    items: [
      { label: "B2B CRM", href: "/crm/commercial", icon: "users" },
      { label: "B2B Studio", href: "/studio/b2b", icon: "video" },
      { label: "B2B Outreach", href: "/campaign-lab", icon: "send" },
    ],
  },
  {
    label: "B2C · Privat",
    items: [
      { label: "B2C CRM", href: "/crm/private", icon: "users" },
      { label: "B2C Studio", href: "/studio/b2c", icon: "video" },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Heute", href: "/command", icon: "bolt" },
      { label: "Antworten", href: "/dashboard?section=inbox", section: "inbox", icon: "inbox" },
      { label: "Calls", href: "/calls", icon: "phone" },
      { label: "Pipeline", href: "/pipeline", icon: "pipeline" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Lead Finder", href: "/dashboard?section=finder", section: "finder", icon: "search" },
      { label: "Daten", href: "/data", icon: "database" },
      { label: "Einstellungen", href: "/settings", icon: "settings" },
    ],
  },
];

const PUBLIC_PREFIXES = ["/v/", "/offer/", "/u/"];
const DASHBOARD_PATHS = new Set(["/", "/dashboard"]);
const SECTION_LABELS: Record<string, string> = {
  finder: "Lead Finder",
  inbox: "Inbox",
};

function initials(user: User) {
  const value = user.user_metadata?.full_name || user.email || "Walkenhorst";
  const parts = String(value).split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WH";
}

function currentSectionFromLocation() {
  if (typeof window === "undefined") return "finder";
  return new URLSearchParams(window.location.search).get("section") || "finder";
}

function clickLegacySection(section: string) {
  const label = SECTION_LABELS[section];
  if (!label) return;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".os-sidebar .os-navbtn"));
  buttons.find((candidate) => (candidate.textContent || "").replace(/\s+/g, " ").trim().includes(label))?.click();
}

function DashboardFrame({ user, children }: { user: User; children: ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dashboardSection, setDashboardSection] = useState("finder");

  useEffect(() => {
    const initial = currentSectionFromLocation();
    setDashboardSection(initial);
    if (DASHBOARD_PATHS.has(window.location.pathname)) window.setTimeout(() => clickLegacySection(initial), 0);

    const handleNavigation = (event: Event) => setDashboardSection((event as CustomEvent<string>).detail || currentSectionFromLocation());
    const handlePopState = () => {
      const section = currentSectionFromLocation();
      setDashboardSection(section);
      if (DASHBOARD_PATHS.has(window.location.pathname)) window.setTimeout(() => clickLegacySection(section), 0);
    };

    window.addEventListener("walkenhorst:section", handleNavigation);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("walkenhorst:section", handleNavigation);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    const section = currentSectionFromLocation();
    setDashboardSection(section);
    if (DASHBOARD_PATHS.has(pathname)) window.setTimeout(() => clickLegacySection(section), 0);
  }, [pathname]);

  function isActive(item: NavItem) {
    if (item.section) return DASHBOARD_PATHS.has(pathname) && dashboardSection === item.section;
    return pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
  }

  function openSection(event: MouseEvent<HTMLAnchorElement>, item: NavItem) {
    setMobileOpen(false);
    if (!item.section) return;
    setDashboardSection(item.section);
    if (!DASHBOARD_PATHS.has(pathname)) return;

    event.preventDefault();
    const next = `/dashboard?section=${encodeURIComponent(item.section)}`;
    window.history.pushState(window.history.state, "", next);
    clickLegacySection(item.section);
    window.dispatchEvent(new CustomEvent("walkenhorst:section", { detail: item.section }));
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    window.location.assign("/command");
  }

  return (
    <AppUserProvider user={user}>
      <div className="wh-app-frame">
        <NavigationProgress />
        <LoginPersonalizationBridge user={user} />
        <div className={`wh-sidebar-backdrop ${mobileOpen ? "is-open" : ""}`} onClick={() => setMobileOpen(false)} />

        <aside className={`wh-app-sidebar ${mobileOpen ? "is-mobile-open" : ""}`}>
          <div className="wh-sidebar-brand">
            <Link className="wh-brand-lockup" href="/command" aria-label="Walkenhorst Outbound">
              <span className="wh-brand-mark">W</span>
              <span className="wh-brand-copy">
                <strong>Walkenhorst</strong>
                <small>B2B + B2C Sales OS</small>
              </span>
            </Link>
          </div>

          <nav className="wh-sidebar-nav" aria-label="Walkenhorst Hauptnavigation">
            {NAV_GROUPS.map((group) => (
              <div className="wh-nav-group" key={group.label}>
                <div className="wh-nav-label">{group.label}</div>
                {group.items.map((item) => (
                  <Link
                    key={`${group.label}-${item.label}`}
                    className={`wh-nav-item ${isActive(item) ? "is-active" : ""}`}
                    href={item.href}
                    prefetch
                    onClick={(event) => openSection(event, item)}
                  >
                    <span className="wh-nav-icon"><NavIcon name={item.icon} /></span>
                    <span className="wh-nav-text">{item.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>

          <div className="wh-sidebar-footer">
            <div className="wh-system-pill"><span />2 getrennte Workspaces</div>
            <div className="wh-user-card">
              <div className="wh-user-avatar">{initials(user)}</div>
              <div className="wh-user-copy">
                <strong>{user.user_metadata?.full_name || "Walkenhorst Admin"}</strong>
                <small>{user.email}</small>
              </div>
              <button className="wh-signout" type="button" onClick={() => void signOut()} title="Abmelden">
                <svg viewBox="0 0 24 24"><path d="M10 5H5v14h5m3-4 4-3-4-3m4 3H9" /></svg>
              </button>
            </div>
          </div>
        </aside>

        <section className="wh-app-workspace">
          <header className="wh-mobile-bar">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="Navigation öffnen"><span /><span /><span /></button>
            <Link href="/command"><span className="wh-mobile-mark">W</span><strong>Walkenhorst</strong></Link>
            <Link className="wh-mobile-studio" href="/crm/commercial" prefetch>B2B CRM</Link>
          </header>
          <div className="wh-app-content">{children}</div>
        </section>

        <LeadRowOpenBridge user={user} />
        <StudioLivePageBridge user={user} />
        <RenderQueueRunner user={user} />
      </div>
    </AppUserProvider>
  );
}

export function ApplicationFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return <>{children}</>;
  return <AuthGate>{(user) => <DashboardFrame user={user}>{children}</DashboardFrame>}</AuthGate>;
}
