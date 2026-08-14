"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type LeadRef={id:string;company_name:string;contact_name:string|null;city:string|null;website:string|null;updated_at:string};

export function LeadRowOpenBridge({ user }: { user: User }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const pathname = usePathname();

  useEffect(() => {
    if (!supabase || (pathname !== "/" && pathname !== "/dashboard")) return;
    let disposed=false;
    let leads:LeadRef[]=[];
    let observer:MutationObserver|null=null;

    const normalize=(value:string|null|undefined)=>String(value||"").replace(/\s+/g," ").trim();
    const matchRow=(row:HTMLTableRowElement)=>{
      const company=normalize(row.querySelector<HTMLElement>(".os-company strong")?.textContent);
      if(!company)return null;
      const secondary=normalize(row.querySelector<HTMLElement>(".os-company small")?.textContent);
      const candidates=leads.filter(lead=>normalize(lead.company_name)===company);
      if(!candidates.length)return null;
      if(secondary){const exact=candidates.find(lead=>[lead.contact_name,lead.city,lead.website].map(normalize).includes(secondary));if(exact)return exact}
      return candidates[0];
    };
    const decorate=()=>{
      if(disposed)return;
      for(const row of Array.from(document.querySelectorAll<HTMLTableRowElement>(".os-table tbody tr"))){
        const lead=matchRow(row);if(!lead)continue;
        row.dataset.leadId=lead.id;row.setAttribute("role","link");row.tabIndex=0;row.title=`${lead.company_name} öffnen`;row.style.cursor="pointer";
      }
    };
    const openRow=(row:HTMLTableRowElement)=>{const id=row.dataset.leadId;if(!id)return false;window.location.assign(`/leads/${encodeURIComponent(id)}`);return true};
    const handleClick=(event:MouseEvent)=>{
      const target=event.target as HTMLElement|null;if(!target||target.closest("a,button,input,select,textarea,label"))return;
      const row=target.closest<HTMLTableRowElement>(".os-table tbody tr");if(!row)return;
      if(!row.dataset.leadId){const lead=matchRow(row);if(lead)row.dataset.leadId=lead.id}
      if(!row.dataset.leadId)return;
      event.preventDefault();event.stopPropagation();openRow(row);
    };
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key!=="Enter"&&event.key!==" ")return;const target=event.target as HTMLElement|null;const row=target?.closest<HTMLTableRowElement>(".os-table tbody tr");if(!row?.dataset.leadId)return;event.preventDefault();event.stopPropagation();openRow(row);
    };

    void supabase.from("energy_leads").select("id,company_name,contact_name,city,website,updated_at").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(750).then(result=>{
      if(disposed||result.error)return;leads=(result.data||[]) as LeadRef[];decorate();observer=new MutationObserver(()=>window.requestAnimationFrame(decorate));observer.observe(document.body,{subtree:true,childList:true});
    });
    document.addEventListener("click",handleClick,true);document.addEventListener("keydown",handleKey,true);
    return()=>{disposed=true;observer?.disconnect();document.removeEventListener("click",handleClick,true);document.removeEventListener("keydown",handleKey,true)};
  }, [pathname, supabase, user.id]);

  return null;
}
