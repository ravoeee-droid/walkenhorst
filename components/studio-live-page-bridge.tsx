"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function StudioLivePageBridge({ user }: { user: User }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [slug, setSlug] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase || pathname !== "/studio") return;
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Studio Lead auswählen"]');
    const leadId = select?.value || "global";
    const label = select?.selectedOptions?.[0]?.textContent?.trim() || null;
    setCompany(leadId === "global" ? null : label);
    if (!leadId || leadId === "global") {
      setSlug(null);
      return;
    }
    const result = await supabase
      .from("energy_video_pages")
      .select("slug,is_public,status,updated_at")
      .eq("user_id", user.id)
      .eq("lead_id", leadId)
      .eq("is_public", true)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSlug(result.error ? null : result.data?.slug || null);
  }, [pathname, supabase, user.id]);

  useEffect(() => {
    if (pathname !== "/studio") return;
    const timer = window.setTimeout(() => void refresh(), 150);
    const interval = window.setInterval(() => void refresh(), 2500);
    const onChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('select[aria-label="Studio Lead auswählen"]')) void refresh();
    };
    const observer = new MutationObserver(() => {
      const status = document.querySelector<HTMLElement>('[class*="status"]');
      if (status?.textContent?.includes("Live veröffentlicht")) void refresh();
    });
    document.addEventListener("change", onChange, true);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("change", onChange, true);
      observer.disconnect();
    };
  }, [pathname, refresh]);

  if (pathname !== "/studio" || !slug) return null;

  return (
    <a
      href={`/v/${encodeURIComponent(slug)}`}
      target="_blank"
      rel="noreferrer"
      style={{
        position: "fixed",
        right: 20,
        top: 82,
        zIndex: 1190,
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "0 16px",
        borderRadius: 14,
        background: "linear-gradient(145deg,#d8b45d,#ad8428)",
        color: "#151713",
        border: "1px solid rgba(126,93,22,.32)",
        boxShadow: "0 14px 34px rgba(32,27,15,.18), inset 0 1px rgba(255,255,255,.45)",
        fontSize: 12,
        fontWeight: 850,
        textDecoration: "none",
        letterSpacing: "-.01em",
      }}
      title={company ? `Live-Seite für ${company} öffnen` : "Live-Seite öffnen"}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#2a8b4f", boxShadow: "0 0 0 4px rgba(42,139,79,.12)" }} />
      Live-Seite öffnen ↗
    </a>
  );
}
