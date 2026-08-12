"use client";

import { useEffect, useRef, useState } from "react";
import { ENERGY_MEDIA_UPLOAD_EVENT, type EnergyMediaUploadProgress } from "@/lib/supabase-browser";

export function StudioUploadProgress(){
  const[current,setCurrent]=useState<EnergyMediaUploadProgress|null>(null);const timer=useRef<number|null>(null);
  useEffect(()=>{const handler=(event:Event)=>{const detail=(event as CustomEvent<EnergyMediaUploadProgress>).detail;if(!detail)return;if(timer.current)window.clearTimeout(timer.current);setCurrent(detail);if(detail.state!=="uploading")timer.current=window.setTimeout(()=>setCurrent(null),detail.state==="complete"?2200:5000)};window.addEventListener(ENERGY_MEDIA_UPLOAD_EVENT,handler);return()=>{window.removeEventListener(ENERGY_MEDIA_UPLOAD_EVENT,handler);if(timer.current)window.clearTimeout(timer.current)}},[]);
  if(!current)return null;
  const mb=(value:number)=>value?`${Math.max(.1,value/1024/1024).toFixed(value<1024*1024?1:0)} MB`:"";
  return <aside aria-live="polite" style={{position:"fixed",right:18,bottom:78,zIndex:160,width:"min(370px,calc(100vw - 36px))",border:"1px solid #d6e1da",borderRadius:12,background:"rgba(255,255,255,.98)",boxShadow:"0 18px 50px rgba(16,40,27,.18)",padding:12,backdropFilter:"blur(12px)"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}><div style={{minWidth:0}}><strong style={{display:"block",overflow:"hidden",fontSize:11,textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{current.fileName}</strong><small style={{color:"#718078",fontSize:8}}>{current.state==="complete"?"Upload abgeschlossen":current.state==="error"?"Upload fehlgeschlagen":`${mb(current.uploaded)} / ${mb(current.total)}`}</small></div><strong style={{color:current.state==="error"?"#b53d3d":"#168251",fontSize:12}}>{current.state==="error"?"!":`${current.percent}%`}</strong></div>
    <div style={{height:6,marginTop:9,overflow:"hidden",borderRadius:999,background:"#edf2ef"}}><div style={{height:"100%",width:`${current.state==="error"?100:current.percent}%`,borderRadius:999,background:current.state==="error"?"#c45454":"#178658",transition:"width .18s ease"}}/></div>
    {current.state==="uploading"&&current.total>6*1024*1024?<small style={{display:"block",marginTop:7,color:"#7b8881",fontSize:8}}>Resumierbarer Upload · bei Netzabbruch wird automatisch fortgesetzt.</small>:null}
  </aside>;
}
