"use client";

import { useEffect } from "react";
import { AuthGate } from "@/components/auth-gate";
import { CampaignLab } from "@/components/campaign-lab";

function CampaignVolumeGuard(){
  useEffect(()=>{
    const apply=()=>document.querySelectorAll<HTMLInputElement>('input[type="number"][max="1000"]').forEach(input=>{input.max="150";input.title="Aktuell maximal 150 Mails pro 24h."});
    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}

export default function CampaignLabPage(){
  return <AuthGate>{user=><><CampaignVolumeGuard/><CampaignLab user={user}/></>}</AuthGate>;
}
