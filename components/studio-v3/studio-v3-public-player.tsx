"use client";

import { useEffect, useRef, useState } from "react";
import { StudioV3BrandKit, StudioV3Item, StudioV3LeadVariables, StudioV3Timeline, studioV3Time } from "@/lib/studio-v3";
import { StudioV3Canvas } from "./studio-v3-canvas";

type Props={timeline:StudioV3Timeline;brand:StudioV3BrandKit;variables:StudioV3LeadVariables;resolveSource?:(item:StudioV3Item)=>string|null;thumbnailWebsiteUrl?:string|null;thumbnailPresenterUrl?:string|null;onPlaybackStart?:()=>void;onProgress?:(mark:number)=>void};
const speeds=[1,1.25,1.5,2];
type EngagementDetail={positionSeconds:number;watchSeconds:number;percent:number;speed:number};
function emit(name:string,detail:EngagementDetail){if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(`walkenhorst:${name}`,{detail}))}

export function StudioV3PublicPlayer({timeline,brand,variables,resolveSource,thumbnailWebsiteUrl,thumbnailPresenterUrl,onPlaybackStart,onProgress}:Props){
 const[timeMs,setTimeMs]=useState(0);
 const[playing,setPlaying]=useState(false);
 const[speedIndex,setSpeedIndex]=useState(0);
 const raf=useRef<number|null>(null);
 const rootRef=useRef<HTMLDivElement>(null);
 const anchor=useRef({wall:0,time:0});
 const started=useRef(false);
 const marks=useRef(new Set<number>());
 const watchedMs=useRef(0);
 const lastTick=useRef<number|null>(null);
 const lastWatchEmit=useRef(0);
 const duration=Math.max(1000,timeline.durationMs),speed=speeds[speedIndex];
 const showPoster=!started.current&&!playing&&timeMs<40&&Boolean(thumbnailWebsiteUrl);
 const detail=(position=timeMs):EngagementDetail=>({positionSeconds:Math.max(0,Math.round(position/1000)),watchSeconds:Math.max(0,Math.round(watchedMs.current/1000)),percent:Math.max(0,Math.min(100,Math.round(position/duration*100))),speed});

 useEffect(()=>{
  if(!playing){if(raf.current)cancelAnimationFrame(raf.current);raf.current=null;lastTick.current=null;return}
  anchor.current={wall:performance.now(),time:timeMs};
  lastTick.current=performance.now();
  const tick=(now:number)=>{
   const previous=lastTick.current??now;
   const elapsed=Math.max(0,Math.min(1000,now-previous));
   lastTick.current=now;
   watchedMs.current+=elapsed;
   const next=Math.min(duration,anchor.current.time+(now-anchor.current.wall)*speed);
   setTimeMs(next);
   const percent=Math.round(next/duration*100);
   for(const mark of[25,50,75,90,100])if(percent>=mark&&!marks.current.has(mark)){marks.current.add(mark);onProgress?.(mark)}
   if(watchedMs.current-lastWatchEmit.current>=5000){lastWatchEmit.current=watchedMs.current;emit("video-watch",{positionSeconds:Math.round(next/1000),watchSeconds:Math.round(watchedMs.current/1000),percent,speed})}
   if(next>=duration){emit("video-complete",{positionSeconds:Math.round(duration/1000),watchSeconds:Math.round(watchedMs.current/1000),percent:100,speed});setPlaying(false);return}
   raf.current=requestAnimationFrame(tick)
  };
  raf.current=requestAnimationFrame(tick);
  return()=>{if(raf.current)cancelAnimationFrame(raf.current)}
 },[duration,onProgress,playing,speed]);

 function toggle(){
  if(timeMs>=duration-20){setTimeMs(0);marks.current.clear();started.current=false;watchedMs.current=0;lastWatchEmit.current=0}
  const nextPlaying=!playing;
  if(nextPlaying){
   if(!started.current){started.current=true;onPlaybackStart?.();emit("video-start",detail())}else emit("video-resume",detail());
   for(const media of Array.from(rootRef.current?.querySelectorAll("video:not([data-poster-video])")||[])){
    const video=media as HTMLVideoElement;
    video.playbackRate=speed;
    void video.play().catch(()=>undefined);
   }
  }else{
   emit("video-pause",detail());
   for(const media of Array.from(rootRef.current?.querySelectorAll("video:not([data-poster-video])")||[]))(media as HTMLVideoElement).pause();
  }
  setPlaying(nextPlaying)
 }

 function seek(next:number){
  const value=Math.min(Math.max(next,0),duration);
  setTimeMs(value);
  anchor.current={wall:performance.now(),time:value};
  emit("video-seek",detail(value))
 }

 async function fullscreen(){
  if(document.fullscreenElement)await document.exitFullscreen().catch(()=>undefined);
  else await rootRef.current?.requestFullscreen().catch(()=>undefined)
 }

 return <div ref={rootRef} data-studio-v3-public-player style={{borderRadius:18,overflow:"hidden",background:"#090909",boxShadow:"0 20px 54px rgba(0,0,0,.18)"}}>
  <div style={{position:"relative"}}>
   <StudioV3Canvas timeline={timeline} timeMs={timeMs} playing={playing} playbackRate={speed} brand={brand} variables={variables} resolveSource={resolveSource}/>
   {showPoster?<button type="button" onClick={toggle} aria-label="Persönliche Videoanalyse abspielen" style={{position:"absolute",inset:0,border:0,padding:0,overflow:"hidden",background:"#07192a",cursor:"pointer",display:"block",width:"100%",height:"100%"}}>
    <img src={thumbnailWebsiteUrl||""} alt="Unternehmenswebsite" draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:"top left",display:"block"}}/>
    <span style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(3,17,30,.02),rgba(3,17,30,.10))"}}/>
    {thumbnailPresenterUrl?<video data-poster-video src={thumbnailPresenterUrl} muted playsInline preload="auto" onLoadedData={event=>{const video=event.currentTarget;try{video.currentTime=Math.min(.08,Math.max(0,(video.duration||1)-.02))}catch{}}} style={{position:"absolute",right:"4.5%",bottom:"6%",width:"12.5%",aspectRatio:"1/1",height:"auto",objectFit:"cover",objectPosition:"center 22%",borderRadius:"50%",border:"3px solid rgba(255,255,255,.96)",background:"#d9e2e7",boxShadow:"0 12px 34px rgba(0,0,0,.30)"}}/>:null}
    <span style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",display:"grid",placeItems:"center",width:"clamp(52px,7vw,76px)",aspectRatio:"1/1",borderRadius:"50%",background:"rgba(255,255,255,.94)",color:"#07192a",boxShadow:"0 12px 34px rgba(0,0,0,.24)",fontSize:"clamp(19px,2.6vw,28px)",paddingLeft:3}}>▶</span>
   </button>:null}
  </div>
  <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:"#0D0D0D",color:"#fff"}}>
   <button onClick={toggle} style={button}>{playing?"Ⅱ":"▶"}</button>
   <button onClick={()=>seek(timeMs-10000)} style={button}>↶10</button>
   <input aria-label="Videoposition" type="range" min={0} max={duration} step={50} value={timeMs} onChange={event=>seek(Number(event.target.value))} style={{flex:1,accentColor:brand.accentColor}}/>
   <span style={{fontSize:10,color:"#b8b8b8",fontVariantNumeric:"tabular-nums"}}>{studioV3Time(timeMs)} / {studioV3Time(duration)}</span>
   <button onClick={()=>setSpeedIndex(i=>(i+1)%speeds.length)} style={button}>{speed}×</button>
   <button onClick={()=>void fullscreen()} style={button}>⛶</button>
  </div>
 </div>
}

const button:React.CSSProperties={border:"1px solid rgba(255,255,255,.14)",borderRadius:7,background:"rgba(255,255,255,.06)",color:"#fff",height:30,minWidth:34,padding:"0 8px",fontSize:10,fontWeight:800,cursor:"pointer"};
