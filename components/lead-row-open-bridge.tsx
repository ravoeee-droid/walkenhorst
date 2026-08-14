"use client";

import { useEffect, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function LeadRowOpenBridge({ user }: { user: User }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!supabase) return;

    const handleClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("a,button,input,select,textarea,label")) return;
      const row = target.closest<HTMLTableRowElement>(".os-table tbody tr");
      if (!row) return;
      const company = row.querySelector<HTMLElement>(".os-company strong")?.textContent?.trim();
      if (!company) return;

      event.preventDefault();
      event.stopPropagation();

      const secondary = row.querySelector<HTMLElement>(".os-company small")?.textContent?.trim() || "";
      const result = await supabase
        .from("energy_leads")
        .select("id,contact_name,city,website,updated_at")
        .eq("user_id", user.id)
        .eq("company_name", company)
        .order("updated_at", { ascending: false })
        .limit(10);

      if (result.error || !result.data?.length) return;
      const exact = result.data.find((lead) =>
        secondary && [lead.contact_name, lead.city, lead.website].filter(Boolean).includes(secondary)
      );
      const lead = exact || result.data[0];
      window.location.assign(`/leads/${encodeURIComponent(lead.id)}`);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [supabase, user.id]);

  return null;
}
