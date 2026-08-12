"use client";

export function SystemModuleLinks(){
  return <nav aria-label="Weitere Sales-OS-Module" style={{position:"fixed",right:18,bottom:18,zIndex:80,display:"flex",gap:7,padding:7,border:"1px solid #e3e7ed",borderRadius:11,background:"rgba(255,255,255,.96)",boxShadow:"0 10px 30px rgba(16,24,40,.12)",backdropFilter:"blur(10px)",flexWrap:"wrap",maxWidth:"calc(100vw - 36px)"}}>
    <a className="os-btn small primary" href="/command">⚡ Heute</a>
    <a className="os-btn small" href="/calls">☎ Caller Queue</a>
    <a className="os-btn small" href="/meetings">◎ Meeting Prep</a>
    <a className="os-btn small" href="/prep">Lead Prep</a>
    <a className="os-btn small" href="/pipeline">▦ Pipeline</a>
    <a className="os-btn small" href="/analytics">↗ Revenue</a>
    <a className="os-btn small" href="/campaign-lab">A/B Campaign Lab</a>
    <a className="os-btn small" href="/proposals">Angebote</a>
    <a className="os-btn small" href="/health">● System Health</a>
    <a className="os-btn small" href="/integrations">⌘ Apps & Webhooks</a>
  </nav>;
}
