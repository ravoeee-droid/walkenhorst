"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/auth-gate";
import { AppUserProvider } from "@/components/app-user-context";
import { FloatingAiAssistant } from "@/components/floating-ai-assistant";
import { LeadRowOpenBridge } from "@/components/lead-row-open-bridge";
import { LoginPersonalizationBridge } from "@/components/login-personalization-bridge";
import { NavigationProgress } from "@/components/navigation-progress";
import { StudioLivePageBridge } from "@/components/studio-live-page-bridge";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type NavItem = { label: string; href: string; icon: string; badge?: string; section?: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Arbeitsbereich", items: [
    { label: "Übersicht", href: "/dashboard?section=overview", section: "overview", icon: "⌂" },
    { label: "Lead Finder", href: "/dashboard?section=finder", section: "finder", icon: "⌕" },
    { label: "Gewerbe CRM", href: "/crm/commercial", icon: "▦", badge: "B2B" },
    { label: "Privatkunden CRM", href: "/crm/private", icon: "◎", badge: "B2C" },
    { label: "Heute", href: "/command", icon: "⚡" },
  ]},
  { label: "Sales", items: [
    { label: "Opportunities", href: "/opportunities", icon: "★" },
    { label: "Sales Brief", href: "/sales-brief", icon: "◈" },
    { label: "Caller Queue", href: "/calls", icon: "☎" },
    { label: "Pipeline", href: "/pipeline", icon: "▦" },
    { label: "Meetings", href: "/meetings", icon: "◉" },
    { label: "Angebote", href: "/proposals", icon: "◇" },
  ]},
  { label: "Outbound", items: [
    { label: "Studio", href: "/studio", icon: "▶", badge: "V3" },
    { label: "Kampagnen", href: "/campaign-lab", icon: "↗" },
    { label: "Inbox", href: "/dashboard?section=inbox", section: "inbox", icon: "✉" },
    { label: "Follow-ups", href: "/dashboard?section=followups", section: "followups", icon: "✓" },
    { label: "Vorlagen", href: "/dashboard?section=templates", section: "templates", icon: "▤" },
    { label: "Deliverability", href: "/deliverability", icon: "◌" },
  ]},
  { label: "Intelligence", items: [
    { label: "PV Intelligence", href: "/pv-intelligence", icon: "☀" },
    { label: "Website Analyse", href: "/dashboard?section=audit", section: "audit", icon: "◇" },
    { label: "SEO Radar", href: "/dashboard?section=seo", section: "seo", icon: "⌁" },
    { label: "Revenue Analytics", href: "/analytics", icon: "↗" },
  ]},
  { label: "Automation & System", items: [
    { label: "Alerts", href: "/alerts", icon: "!" },
    { label: "Revival", href: "/revival", icon: "↻" },
    { label: "Data Hygiene", href: "/data-hygiene", icon: "✓" },
    { label: "Daten", href: "/data", icon: "⇄" },
    { label: "Integrationen", href: "/integrations", icon: "⌘" },
    { label: "Go-Live", href: "/launch", icon: "●" },
    { label: "System Health", href: "/health", icon: "◉" },
    { label: "Settings", href: "/settings", icon: "⚙" },
  ]},
];

const PUBLIC_PREFIXES = ["/v/", "/offer/", "/u/"];
const DASHBOARD_PATHS = new Set(["/", "/dashboard"]);
const SECTION_LABELS: Record<string, string> = { overview: "Übersicht", finder: "Lead Finder", leads: "Leads", inbox: "Inbox", followups: "Follow-ups", templates: "Vorlagen", audit: "Website Analyse", seo: "SEO Radar" };

function initials(user: User) {
  const value = user.user_metadata?.full_name || user.email || "Walkenhorst";
  const parts = String(value).split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WH";
}
function currentSectionFromLocation() { if (typeof window === "undefined") return "overview"; return new URLSearchParams(window.location.search).get("section") || "overview"; }
function clickLegacySection(section: string) {
  const label = SECTION_LABELS[section]; if (!label) return;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".os-sidebar .os-navbtn"));
  const button = buttons.find((candidate) => (candidate.textContent || "").replace(/\s+/g, " ").trim().includes(label));
  button?.click();
}

function DashboardFrame({ user, children }: { user: User; children: ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dashboardSection, setDashboardSection] = useState("overview");

  useEffect(() => {
    const initial = currentSectionFromLocation(); setDashboardSection(initial);
    if (DASHBOARD_PATHS.has(window.location.pathname)) window.setTimeout(() => clickLegacySection(initial), 0);
    const handleNavigation = (event: Event) => setDashboardSection((event as CustomEvent<string>).detail || currentSectionFromLocation());
    const handlePopState = () => { const section = currentSectionFromLocation(); setDashboardSection(section); if (DASHBOARD_PATHS.has(window.location.pathname)) window.setTimeout(() => clickLegacySection(section), 0); };
    window.addEventListener("walkenhorst:section", handleNavigation); window.addEventListener("popstate", handlePopState);
    return () => { window.removeEventListener("walkenhorst:section", handleNavigation); window.removeEventListener("popstate", handlePopState); };
  }, []);
  useEffect(() => { setMobileOpen(false); const section = currentSectionFromLocation(); setDashboardSection(section); if (DASHBOARD_PATHS.has(pathname)) window.setTimeout(() => clickLegacySection(section), 0); }, [pathname]);
  useEffect(() => { setCollapsed(window.localStorage.getItem("walkenhorst.sidebar.collapsed") === "1"); }, []);

  function toggleCollapsed() { setCollapsed((value) => { const next = !value; window.localStorage.setItem("walkenhorst.sidebar.collapsed", next ? "1" : "0"); return next; }); }
  function isActive(item: NavItem) { if (item.section) return DASHBOARD_PATHS.has(pathname) && dashboardSection === item.section; return pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)); }
  function openSection(event: MouseEvent<HTMLAnchorElement>, item: NavItem) {
    setMobileOpen(false); if (!item.section) return; setDashboardSection(item.section); if (!DASHBOARD_PATHS.has(pathname)) return;
    event.preventDefault(); const next = `/dashboard?section=${encodeURIComponent(item.section)}`; window.history.pushState(window.history.state, "", next); clickLegacySection(item.section); window.dispatchEvent(new CustomEvent("walkenhorst:section", { detail: item.section }));
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); window.location.assign("/dashboard"); }

  return <AppUserProvider user={user}><div className={`wh-app-frame ${collapsed ? "is-collapsed" : ""}`}>
    <NavigationProgress /><LoginPersonalizationBridge user={user} />
    <div className={`wh-sidebar-backdrop ${mobileOpen ? "is-open" : ""}`} onClick={() => setMobileOpen(false)} />
    <aside className={`wh-app-sidebar ${mobileOpen ? "is-mobile-open" : ""}`}>
      <div className="wh-sidebar-brand">
        <Link className="wh-brand-lockup" href="/dashboard?section=overview" aria-label="Walkenhorst Übersicht"><span className="wh-brand-mark">W</span><span className="wh-brand-copy"><strong>Walkenhorst</strong><small>Energy Sales OS</small></span></Link>
        <button className="wh-collapse-button" type="button" onClick={toggleCollapsed} title={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}>{collapsed ? "›" : "‹"}</button>
      </div>
      <nav className="wh-sidebar-nav" aria-label="Walkenhorst Hauptnavigation">{NAV_GROUPS.map((group) => <div className="wh-nav-group" key={group.label}><div className="wh-nav-label">{group.label}</div>{group.items.map((item) => <Link key={`${group.label}-${item.label}`} className={`wh-nav-item ${isActive(item) ? "is-active" : ""}`} href={item.href} prefetch title={collapsed ? item.label : undefined} onClick={(event) => openSection(event, item)}><span className="wh-nav-icon" aria-hidden="true">{item.icon}</span><span className="wh-nav-text">{item.label}</span>{item.badge ? <span className="wh-nav-badge">{item.badge}</span> : null}</Link>)}</div>)}</nav>
      <div className="wh-sidebar-footer"><div className="wh-system-pill"><span />System bereit</div><div className="wh-user-card"><div className="wh-user-avatar">{initials(user)}</div><div className="wh-user-copy"><strong>{user.user_metadata?.full_name || "Walkenhorst Admin"}</strong><small>{user.email}</small></div><button className="wh-signout" type="button" onClick={() => void signOut()} title="Abmelden">↗</button></div></div>
    </aside>
    <section className="wh-app-workspace"><header className="wh-mobile-bar"><button type="button" onClick={() => setMobileOpen(true)} aria-label="Navigation öffnen">☰</button><Link href="/dashboard?section=overview"><span className="wh-mobile-mark">W</span><strong>Walkenhorst</strong></Link><Link className="wh-mobile-studio" href="/studio" prefetch>Studio V3</Link></header><div className="wh-app-content">{children}</div></section>
    <LeadRowOpenBridge user={user} /><StudioLivePageBridge user={user} /><FloatingAiAssistant user={user} />
  </div></AppUserProvider>;
}

export function ApplicationFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return <>{children}</>;
  return <AuthGate>{(user) => <DashboardFrame user={user}>{children}</DashboardFrame>}</AuthGate>;
}
