"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";

function displayName(user:User){
  const meta=String(user.user_metadata?.full_name||user.user_metadata?.name||"").trim();
  if(meta)return meta;
  const local=String(user.email||"").split("@")[0].replace(/[._-]+/g," ").trim();
  return local?local.replace(/\b\w/g,char=>char.toUpperCase()):"Walkenhorst Admin";
}

export function LoginPersonalizationBridge({user}:{user:User}){
  const pathname=usePathname();
  useEffect(()=>{
    if(pathname!=="/"&&pathname!=="/dashboard")return;
    const name=displayName(user);const first=name.split(/\s+/)[0]||name;
    let frame=0;let observer:MutationObserver|null=null;
    const apply=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      document.querySelectorAll<HTMLElement>(".os-user strong").forEach(el=>{el.textContent=name});
      document.querySelectorAll<HTMLElement>(".os-title").forEach(el=>{if((el.textContent||"").trim().startsWith("Guten Tag"))el.textContent=`Guten Tag, ${first}.`});
    })};
    apply();observer=new MutationObserver(apply);observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    return()=>{cancelAnimationFrame(frame);observer?.disconnect()};
  },[pathname,user]);
  return null;
}
