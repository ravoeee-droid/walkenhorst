"use client";

import { useEffect, useRef, useState } from "react";
import { StudioV3BrandKit, StudioV3Item, StudioV3LeadVariables, StudioV3Timeline, studioV3Time } from "@/lib/studio-v3";
import { StudioV3Canvas } from "./studio-v3-canvas";

type Props={timeline:StudioV3Timeline;brand:StudioV3BrandKit;variables:StudioV3LeadVariables;resolveSource?:(item:StudioV3Item)=>string|null;onPlaybackStart?:()=>void;onProgress?:(mark:number)=>void};
const speeds=[1,1.25,1.5,2];

export function StudioV3PublicPlayer({timeline,brand,variables,resolveSource,onPlaybackStart,onProgress}:Props){
 const[timeMs,setTimeMs]=useState(0);
 const[playing,setPlaying]=useState(false);
 const[speedIndex,setSpeedIndex]=useState(0);
 const raf=useRef<number|null>(null);
 const rootRef=useRef<HTMLDivElement>(null);
 const anchor=useRef({wall:0,time:0});
 const started=useRef(false);
 const marks=useRef(new Set<number>());
 const duration=Math.max(1000,timeline.durationMs),speed=speeds[speedIndex];

 useEffect(()=>{
  if(!playing){if(raf.current)cancelAnimationFrame(raf.current);raf.current=null;return}
  anchor.current={wall:performance.now(),time:timeMs};
  const tick=(now:number)=>{
   const next=Math.min(duration,anchor.current.time+(now-anchor.current.wall)*speed);
   setTimeMs(next);
   const percent=Math.round(next/duration*100);
   for(const mark of[25,50,75,90,100])if(percent>=mark&&!marks.current.has(mark)){marks.current.add(mark);onProgress?.(mark)}
   if(next>=duration){setPlaying(false);return}
   raf.current=requestAnimationFrame(tick)
  };
  raf.current=requestAnimationFrame(tick);
  return()=>{if(raf.current)cancelAnimationFrame(raf.current)}
 },[duration,onProgress,playing,speed,timeMs]);

 function toggle(){
  if(timeMs>=duration-20){setTimeMs(0);marks.current.clear();started.current=false}
  const nextPlaying=!playing;
  if(nextPlaying){
   if(!started.current){started.current=true;onPlaybackStart?.()}
   // Important for iOS Safari: start nested media synchronously inside the user's click gesture.
   for(const media of Array.from(rootRef.current?.querySelectorAll("video")||[])){
    const video=media as HTMLVideoElement;
    video.playbackRate=speed;
    void video.play().catch(()=>undefined);
   }
  }else{
   for(const media of Array.from(rootRef.current?.querySelectorAll("video")||[]))(media as HTMLVideoElement).pause();
  }
  setPlaying(nextPlaying)
 }

 function seek(next:number){
  const value=Math.min(Math.max(next,0),duration);
  setTimeMs(value);
  anchor.current={wall:performance.now(),time:value}
 }

 async function fullscreen(){
  if(document.fullscreenElement)await document.exitFullscreen().catch(()=>undefined);
  else await rootRef.current?.requestFullscreen().catch(()=>undefined)
 }

 return <div ref={rootRef} data-studio-v3-public-player style={{borderRadius:18,overflow:"hidden",background:"#090909",boxShadow:"0 28px 80px rgba(0,0,0,.22)"}}>
  <StudioV3Canvas timeline={timeline} timeMs={timeMs} playing={playing} playbackRate={speed} brand={brand} variables={variables} resolveSource={resolveSource}/>
  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#0D0D0D",color:"#fff"}}>
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
