"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnergyStudioSegment } from "@/lib/energy-studio";
import styles from "./segmented-energy-video-player.module.css";

type Props = {
  segments: EnergyStudioSegment[];
  websiteCaptureUrl?: string | null;
  presenterVideoUrl?: string | null;
  presenterName?: string;
  company: string;
  accentColor?: string;
  compact?: boolean;
  seekRequest?: { index: number; nonce: number };
  onPlaybackStart?: () => void;
  onProgress?: (percent: number) => void;
  onActiveSegmentChange?: (index: number) => void;
};

const VIDEO_DURATION_FALLBACK=15;
const rates=[1,1.25,1.5,2];
const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),max);
const formatTime=(value:number)=>{const safe=Number.isFinite(value)?Math.max(0,value):0;const min=Math.floor(safe/60);const sec=Math.floor(safe%60);return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`};

export function SegmentedEnergyVideoPlayer({segments,websiteCaptureUrl=null,presenterVideoUrl=null,presenterName="Walkenhorst Energie",company,accentColor="#17945c",compact=false,seekRequest,onPlaybackStart,onProgress,onActiveSegmentChange}:Props){
  const cleanSegments=useMemo(()=>segments.filter(segment=>segment.type==="website"||((segment.type==="video"||segment.type==="image")&&segment.mediaUrl)),[segments]);
  const effectiveSegments=cleanSegments.length?cleanSegments:[{id:"website-fallback",type:"website",role:"website",label:"Website",duration:8} satisfies EnergyStudioSegment];
  const[activeIndex,setActiveIndex]=useState(0);const[localTime,setLocalTime]=useState(0);const[durations,setDurations]=useState<Record<string,number>>({});const[playing,setPlaying]=useState(false);const[muted,setMuted]=useState(false);const[rateIndex,setRateIndex]=useState(0);const[buffering,setBuffering]=useState(false);
  const playerRef=useRef<HTMLDivElement>(null);const segmentVideoRef=useRef<HTMLVideoElement>(null);const presenterVideoRef=useRef<HTMLVideoElement>(null);const startedRef=useRef(false);const reportedRef=useRef(new Set<number>());const activeIndexRef=useRef(0);const lastSeekNonceRef=useRef<number|null>(null);
  const activeSegment=effectiveSegments[Math.min(activeIndex,effectiveSegments.length-1)];const playbackRate=rates[rateIndex];const showPresenter=Boolean(presenterVideoUrl&&activeSegment.role!=="speaker");
  const currentDuration=activeSegment.type!=="video"?clamp(activeSegment.duration??4,1,120):durations[activeSegment.id]??clamp(activeSegment.duration??VIDEO_DURATION_FALLBACK,1,120);
  const segmentDurations=effectiveSegments.map(segment=>segment.type!=="video"?clamp(segment.duration??4,1,120):durations[segment.id]??clamp(segment.duration??VIDEO_DURATION_FALLBACK,1,120));
  const starts=segmentDurations.map((_,index)=>segmentDurations.slice(0,index).reduce((sum,duration)=>sum+duration,0));const totalDuration=segmentDurations.reduce((sum,duration)=>sum+duration,0);const globalTime=clamp((starts[activeIndex]??0)+localTime,0,totalDuration);const nextVideoUrl=effectiveSegments.slice(activeIndex+1).find(segment=>segment.type==="video"&&segment.mediaUrl)?.mediaUrl;

  useEffect(()=>{if(!onProgress||totalDuration<=0)return;const percent=Math.min(100,Math.round(globalTime/totalDuration*100));for(const mark of[25,50,75,90,100])if(percent>=mark&&!reportedRef.current.has(mark)){reportedRef.current.add(mark);onProgress(mark)}},[globalTime,onProgress,totalDuration]);
  const reportStart=useCallback(()=>{if(startedRef.current)return;startedRef.current=true;onPlaybackStart?.()},[onPlaybackStart]);
  const applyPlayback=useCallback(async()=>{const scene=segmentVideoRef.current;const presenter=presenterVideoRef.current;if(!playing){scene?.pause();presenter?.pause();return}reportStart();const startsPlaying:Promise<unknown>[]=[];if(scene&&activeSegment.type==="video"){scene.playbackRate=playbackRate;scene.muted=activeSegment.role==="proof"||muted;startsPlaying.push(scene.play().catch(()=>undefined))}if(presenter&&showPresenter){presenter.playbackRate=playbackRate;presenter.muted=muted;startsPlaying.push(presenter.play().catch(()=>undefined))}else presenter?.pause();await Promise.all(startsPlaying)},[activeSegment.role,activeSegment.type,muted,playbackRate,playing,reportStart,showPresenter]);
  useEffect(()=>{activeIndexRef.current=activeIndex;onActiveSegmentChange?.(activeIndex)},[activeIndex,onActiveSegmentChange]);
  useEffect(()=>{if(activeIndex>=effectiveSegments.length){setActiveIndex(0);setLocalTime(0)}},[activeIndex,effectiveSegments.length]);
  useEffect(()=>{void applyPlayback()},[activeIndex,applyPlayback]);
  useEffect(()=>{if(!playing||activeSegment.type==="video")return;let previous=performance.now();const timer=window.setInterval(()=>{const now=performance.now();const elapsed=(now-previous)/1000*playbackRate;previous=now;setLocalTime(current=>current+elapsed)},80);return()=>window.clearInterval(timer)},[activeSegment.type,playbackRate,playing]);
  const goToSegment=useCallback((index:number,offset=0)=>{const nextIndex=clamp(index,0,effectiveSegments.length-1);const next=effectiveSegments[nextIndex];const duration=next.type!=="video"?clamp(next.duration??4,1,120):durations[next.id]??clamp(next.duration??VIDEO_DURATION_FALLBACK,1,120);const safeOffset=clamp(offset,0,Math.max(0,duration-.01));setActiveIndex(nextIndex);setLocalTime(safeOffset);window.requestAnimationFrame(()=>{const video=segmentVideoRef.current;if(video&&next.type==="video")try{video.currentTime=safeOffset}catch{}})},[durations,effectiveSegments]);
  useEffect(()=>{if(!seekRequest||seekRequest.nonce<=0||lastSeekNonceRef.current===seekRequest.nonce)return;lastSeekNonceRef.current=seekRequest.nonce;goToSegment(seekRequest.index,0);setPlaying(true)},[goToSegment,seekRequest]);
  const advance=useCallback(()=>{const current=activeIndexRef.current;if(current<effectiveSegments.length-1){goToSegment(current+1,0);return}setPlaying(false);setLocalTime(segmentDurations[current]??0)},[effectiveSegments.length,goToSegment,segmentDurations]);
  useEffect(()=>{if(activeSegment.type!=="video"&&localTime>=currentDuration)advance()},[activeSegment.type,advance,currentDuration,localTime]);
  function seekTo(target:number){const safe=clamp(target,0,Math.max(0,totalDuration-.01));let index=effectiveSegments.length-1;for(let candidate=0;candidate<starts.length;candidate++){if(safe<starts[candidate]+segmentDurations[candidate]){index=candidate;break}}goToSegment(index,safe-starts[index]);const presenter=presenterVideoRef.current;if(presenter?.duration&&Number.isFinite(presenter.duration))presenter.currentTime=safe%presenter.duration}
  function togglePlayback(){if(!playing&&globalTime>=totalDuration-.05){reportedRef.current.clear();startedRef.current=false;goToSegment(0,0)}setPlaying(current=>!current)}
  async function toggleFullscreen(){if(!playerRef.current)return;if(document.fullscreenElement)await document.exitFullscreen().catch(()=>undefined);else await playerRef.current.requestFullscreen().catch(()=>undefined)}
  return <div ref={playerRef} className={`${styles.player} ${compact?styles.compact:styles.landing} ${playing?styles.isPlaying:""}`} style={{"--player-accent":accentColor} as React.CSSProperties}>
    <div className={styles.stage}>
      {activeSegment.type==="video"&&activeSegment.mediaUrl?<video key={activeSegment.id} ref={segmentVideoRef} className={`${styles.sceneVideo} ${activeSegment.role==="proof"?styles.proofVideo:""}`} src={activeSegment.mediaUrl} playsInline preload="auto" muted={activeSegment.role==="proof"||muted} onLoadStart={()=>setBuffering(true)} onCanPlay={()=>{setBuffering(false);void applyPlayback()}} onLoadedMetadata={event=>{const duration=event.currentTarget.duration;if(Number.isFinite(duration)&&duration>0)setDurations(current=>({...current,[activeSegment.id]:duration}));event.currentTarget.currentTime=clamp(localTime,0,Math.max(0,duration-.01));void applyPlayback()}} onTimeUpdate={event=>setLocalTime(event.currentTarget.currentTime)} onWaiting={()=>setBuffering(true)} onPlaying={()=>setBuffering(false)} onError={()=>setBuffering(false)} onEnded={advance}/>:activeSegment.type==="image"&&activeSegment.mediaUrl?<img className={styles.sceneImage} src={activeSegment.mediaUrl} alt={activeSegment.label} decoding="async"/>:websiteCaptureUrl?<div className={styles.websiteViewport}><img className={styles.websiteImage} src={websiteCaptureUrl} alt={`Website von ${company}`} decoding="async" style={{transitionDuration:`${Math.max(1,currentDuration/playbackRate)}s`}}/></div>:<div className={styles.websiteFallback}><div className={styles.fallbackNav}><strong>{company}</strong><span>Leistungen</span><span>Unternehmen</span><i>Kontakt</i></div><div className={styles.fallbackHero}><small>Potenzialanalyse</small><strong>{company}<br/>Energie intelligent nutzen.</strong><span/></div></div>}
      {showPresenter?<div className={styles.talkingHead}><video ref={presenterVideoRef} className={styles.talkingHeadVideo} src={presenterVideoUrl??undefined} muted={muted} playsInline preload="auto" loop onLoadedMetadata={event=>{if(Number.isFinite(event.currentTarget.duration)&&event.currentTarget.duration>0)event.currentTarget.currentTime=globalTime%event.currentTarget.duration;void applyPlayback()}} onCanPlay={()=>void applyPlayback()}/><small>{presenterName}</small></div>:null}
      {activeSegment.caption?<div className={styles.sceneLabel}>{activeSegment.caption}</div>:null}
      {buffering&&activeSegment.type==="video"?<span className={styles.spinner} aria-label="Video wird geladen"/>:null}
      {nextVideoUrl?<video className={styles.preload} src={nextVideoUrl} preload="auto" muted playsInline/>:null}
      {!playing&&globalTime<=.05?<button className={styles.startOverlay} onClick={togglePlayback} aria-label="Persönliche Analyse starten"><span>▶</span><strong>Persönliche Analyse starten</strong></button>:null}
    </div>
    <div className={styles.controls}>
      <button onClick={togglePlayback} aria-label={playing?"Pausieren":"Abspielen"} className={styles.primaryControl}>{playing?"Ⅱ":"▶"}</button><button onClick={()=>seekTo(globalTime-10)} aria-label="10 Sekunden zurück">↶<small>10</small></button><button onClick={()=>seekTo(globalTime+10)} aria-label="10 Sekunden vor">↷<small>10</small></button>
      <div className={styles.timeline}><input type="range" min={0} max={Math.max(totalDuration,.01)} step={.05} value={globalTime} onChange={event=>seekTo(Number(event.target.value))} aria-label="Videoposition" style={{"--progress":`${totalDuration?globalTime/totalDuration*100:0}%`} as React.CSSProperties}/><div className={styles.segmentMarkers}>{effectiveSegments.map((segment,index)=><button key={segment.id} className={index===activeIndex?styles.activeMarker:""} style={{flexGrow:segmentDurations[index]}} onClick={()=>seekTo(starts[index])} aria-label={`${segment.label} abspielen`} title={segment.label}/>)}</div></div>
      <span className={styles.time}>{formatTime(globalTime)} / {formatTime(totalDuration)}</span><button onClick={()=>setRateIndex(current=>(current+1)%rates.length)} aria-label="Geschwindigkeit ändern" className={styles.rate}>{playbackRate}×</button><button onClick={()=>setMuted(current=>!current)} aria-label={muted?"Ton einschalten":"Ton ausschalten"}>{muted?"🔇":"🔊"}</button><button onClick={()=>void toggleFullscreen()} aria-label="Vollbild">⛶</button>
    </div>
  </div>;
}
