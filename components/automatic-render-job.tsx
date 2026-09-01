"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { renderStudioV3Browser } from "@/lib/studio-v3-browser-render";
import { WALKENHORST_BRAND_DEFAULT, type StudioV3BrandKit, type StudioV3LeadVariables, type StudioV3Timeline } from "@/lib/studio-v3";

type Manifest={
  ok:boolean;
  jobId:string;
  pageId:string;
  leadId:string;
  timeline:StudioV3Timeline;
  brand:Partial<StudioV3BrandKit>;
  variables:StudioV3LeadVariables;
  upload:{bucket:string;path:string;token:string};
};

function setDocumentStatus(status:string,error?:string){
  document.documentElement.dataset.renderStatus=status;
  if(error)document.documentElement.dataset.renderError=error.slice(0,500);
  else delete document.documentElement.dataset.renderError;
}

export function AutomaticRenderJob({jobId,token}:{jobId:string;token:string}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const[status,setStatus]=useState("Vorbereitung");
  const[progress,setProgress]=useState(0);
  const[error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let stopped=false;
    let lastPersisted=0;
    const endpoint=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/render-orchestrator`;
    const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
    const call=async(action:string,extra:Record<string,unknown>={})=>{
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",apikey:key,authorization:`Bearer ${key}`},body:JSON.stringify({action,jobId,token,...extra}),cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data?.error)throw new Error(String(data?.error||`Render-Orchestrator HTTP ${response.status}`));
      return data;
    };

    async function run(){
      try{
        setDocumentStatus("preparing");
        const manifest=await call("manifest") as Manifest;
        if(stopped)return;
        const brand:StudioV3BrandKit={...WALKENHORST_BRAND_DEFAULT,...(manifest.brand||{}),metadata:{...WALKENHORST_BRAND_DEFAULT.metadata,...(manifest.brand?.metadata||{})}};
        setStatus("Finales MP4 wird gerendert");
        setProgress(2);
        setDocumentStatus("rendering");
        const result=await renderStudioV3Browser({
          timeline:manifest.timeline,
          brand,
          variables:manifest.variables,
          resolveSource:item=>item.sourceUrl||null,
          maxWidth:1920,
          onProgress:value=>{
            const next=Math.max(2,Math.min(94,Math.round(value)));
            setProgress(next);
            if(next-lastPersisted>=5){
              lastPersisted=next;
              void call("progress",{progress:next}).catch(()=>undefined);
            }
          },
        });
        if(stopped)return;
        if(result.format!=="mp4"||result.mimeType!=="video/mp4"||result.blob.size<100000)throw new Error("Renderer hat keine gültige MP4-Datei erzeugt");
        setStatus("MP4 wird gespeichert");
        setProgress(96);
        setDocumentStatus("uploading");
        await call("progress",{progress:96});
        if(!supabase)throw new Error("Supabase-Client fehlt");
        const upload=await supabase.storage.from(manifest.upload.bucket).uploadToSignedUrl(manifest.upload.path,manifest.upload.token,result.blob,{contentType:"video/mp4",cacheControl:"31536000"});
        if(upload.error)throw upload.error;
        await call("complete",{bytes:result.blob.size,width:result.width,height:result.height});
        if(stopped)return;
        setProgress(100);
        setStatus("Fertig");
        setError(null);
        setDocumentStatus("completed");
      }catch(e){
        const message=e instanceof Error?e.message:"Rendering fehlgeschlagen";
        setError(message);
        setStatus("Fehlgeschlagen");
        setDocumentStatus("failed",message);
        await call("fail",{error:message}).catch(()=>undefined);
      }
    }
    void run();
    return()=>{stopped=true};
  },[jobId,supabase,token]);

  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#050b12",color:"#fff",fontFamily:"Arial,sans-serif"}}><section style={{width:"min(520px,88vw)",padding:28,borderRadius:18,background:"#0b1724",border:"1px solid rgba(255,255,255,.09)"}}><div style={{fontSize:12,opacity:.6,marginBottom:8}}>Walkenhorst Production Render</div><strong style={{fontSize:20}}>{status}</strong><div style={{height:8,marginTop:18,borderRadius:99,background:"rgba(255,255,255,.10)",overflow:"hidden"}}><div style={{width:`${progress}%`,height:"100%",background:"#31c7a4",transition:"width .2s linear"}}/></div><div style={{marginTop:9,fontSize:12,opacity:.7}}>{progress}% · 1920×1080 · MP4</div>{error?<pre style={{whiteSpace:"pre-wrap",fontSize:11,color:"#ffb7b7",marginTop:16}}>{error}</pre>:null}</section></main>;
}