"use client";

import { useEffect, useMemo, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type EngagementDetail={positionSeconds?:number;watchSeconds?:number;percent?:number;speed?:number};
type Pending={eventType:string;detail?:EngagementDetail;metadata?:Record<string,unknown>};
type MediaState={started:boolean;watchMs:number;lastPerf:number|null;lastEmitMs:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeSession(slug:string){
  const key=`walkenhorst-video-session:${slug}`;
  try{const existing=sessionStorage.getItem(key);if(existing)return existing;const id=crypto.randomUUID();sessionStorage.setItem(key,id);return id}catch{return crypto.randomUUID()}
}

function clickKind(target:Element){
  const el=target.closest("a,button");
  if(!el||el.closest("[data-studio-v3-public-player]"))return null;
  const href=el instanceof HTMLAnchorElement?el.href:"";
  const text=(el.textContent||"").replace(/\s+/g," ").trim().slice(0,180);
  const signature=`${href} ${text}`.toLowerCase();
  if(/wa\.me|whatsapp/.test(signature))return{action:"whatsapp",href,text};
  if(/walkenhorst-eko\.de|energiekosten|energie-ersparnis/.test(signature))return{action:"energiekosten_rechner",href,text};
  if(/walkenhorst-pv\.de|pv-rechner|pv-ertrag/.test(signature))return{action:"pv_rechner",href,text};
  return null;
}

export function VideoEngagementTracker({slug}:{slug:string}){
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const pageId=useRef<string|null>(null);
  const sessionId=useRef<string>("");
  const messageToken=useRef<string|null>(null);
  const pending=useRef<Pending[]>([]);
  const mediaStates=useRef(new WeakMap<HTMLVideoElement,MediaState>());

  useEffect(()=>{
    if(!supabase)return;
    sessionId.current=safeSession(slug);
    const raw=new URLSearchParams(window.location.search).get("mt")||"";
    messageToken.current=UUID.test(raw)?raw:null;
    let cancelled=false;

    const insert=async(eventType:string,detail:EngagementDetail={},metadata:Record<string,unknown>={})=>{
      if(!pageId.current){pending.current.push({eventType,detail,metadata});return}
      await supabase.from("energy_video_events").insert({
        video_page_id:pageId.current,
        event_type:eventType,
        watch_percent:Number.isFinite(detail.percent)?Math.max(0,Math.min(100,Math.round(detail.percent!))):null,
        playback_seconds:Number.isFinite(detail.positionSeconds)?Math.max(0,Math.round(detail.positionSeconds!)):null,
        watch_seconds:Number.isFinite(detail.watchSeconds)?Math.max(0,Math.round(detail.watchSeconds!)):null,
        message_tracking_token:messageToken.current,
        session_id:sessionId.current,
        metadata:{source:"public_video_lp",speed:detail.speed??null,...metadata},
        user_agent:navigator.userAgent.slice(0,500),
        referrer:(document.referrer||"").slice(0,2048),
      });
    };

    void supabase.from("energy_video_pages").select("id").eq("slug",slug).eq("is_public",true).in("status",["ready","sent"]).maybeSingle().then(async({data})=>{
      if(cancelled||!data?.id)return;
      pageId.current=String(data.id);
      await insert("session_view",{}, {url:window.location.href.split("#")[0],attributed:Boolean(messageToken.current)});
      const queued=[...pending.current];pending.current=[];
      for(const item of queued)void insert(item.eventType,item.detail,item.metadata);
    });

    const customNames=["video-start","video-resume","video-pause","video-watch","video-seek","video-complete"] as const;
    const handlers=new Map<string,EventListener>();
    for(const name of customNames){
      const handler=((event:Event)=>{const detail=(event as CustomEvent<EngagementDetail>).detail||{};void insert(name.replace("video-","playback_"),detail)}) as EventListener;
      handlers.set(name,handler);window.addEventListener(`walkenhorst:${name}`,handler);
    }

    const clickHandler=(event:MouseEvent)=>{
      if(!(event.target instanceof Element))return;
      const hit=clickKind(event.target);if(!hit)return;
      void insert("cta_attributed",{},hit);
    };
    document.addEventListener("click",clickHandler,true);

    const stateFor=(video:HTMLVideoElement)=>{let state=mediaStates.current.get(video);if(!state){state={started:false,watchMs:0,lastPerf:null,lastEmitMs:0};mediaStates.current.set(video,state)}return state};
    const mediaPlay=(event:Event)=>{const video=event.target;if(!(video instanceof HTMLVideoElement)||!video.controls)return;const state=stateFor(video);state.lastPerf=performance.now();if(!state.started){state.started=true;void insert("playback_start",{positionSeconds:video.currentTime,watchSeconds:state.watchMs/1000,percent:video.duration?video.currentTime/video.duration*100:0})}else void insert("playback_resume",{positionSeconds:video.currentTime,watchSeconds:state.watchMs/1000,percent:video.duration?video.currentTime/video.duration*100:0})};
    const mediaTime=(event:Event)=>{const video=event.target;if(!(video instanceof HTMLVideoElement)||!video.controls||video.paused)return;const state=stateFor(video);const now=performance.now();if(state.lastPerf!==null)state.watchMs+=Math.max(0,Math.min(1500,now-state.lastPerf));state.lastPerf=now;if(state.watchMs-state.lastEmitMs>=5000){state.lastEmitMs=state.watchMs;void insert("playback_watch",{positionSeconds:video.currentTime,watchSeconds:state.watchMs/1000,percent:video.duration?video.currentTime/video.duration*100:0,speed:video.playbackRate})}};
    const mediaPause=(event:Event)=>{const video=event.target;if(!(video instanceof HTMLVideoElement)||!video.controls||video.ended)return;const state=stateFor(video);state.lastPerf=null;void insert("playback_pause",{positionSeconds:video.currentTime,watchSeconds:state.watchMs/1000,percent:video.duration?video.currentTime/video.duration*100:0,speed:video.playbackRate})};
    const mediaEnd=(event:Event)=>{const video=event.target;if(!(video instanceof HTMLVideoElement)||!video.controls)return;const state=stateFor(video);state.lastPerf=null;void insert("playback_complete",{positionSeconds:video.duration||video.currentTime,watchSeconds:state.watchMs/1000,percent:100,speed:video.playbackRate})};
    document.addEventListener("play",mediaPlay,true);document.addEventListener("timeupdate",mediaTime,true);document.addEventListener("pause",mediaPause,true);document.addEventListener("ended",mediaEnd,true);

    const visibility=()=>{if(document.visibilityState==="hidden")void insert("session_hidden")};
    document.addEventListener("visibilitychange",visibility);

    return()=>{
      cancelled=true;
      for(const[name,handler]of handlers)window.removeEventListener(`walkenhorst:${name}`,handler);
      document.removeEventListener("click",clickHandler,true);
      document.removeEventListener("play",mediaPlay,true);document.removeEventListener("timeupdate",mediaTime,true);document.removeEventListener("pause",mediaPause,true);document.removeEventListener("ended",mediaEnd,true);
      document.removeEventListener("visibilitychange",visibility);
    };
  },[slug,supabase]);

  return null;
}
