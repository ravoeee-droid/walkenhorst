from pathlib import Path
import re

p=Path('components/lead-detail-workspace.tsx')
s=p.read_text()

def rep(old,new):
    global s
    if old not in s: raise SystemExit('missing: '+old[:100])
    s=s.replace(old,new,1)

def reg(pattern,repl):
    global s
    s2,n=re.subn(pattern,lambda m:repl,s,count=1,flags=re.S)
    if n!=1: raise SystemExit('regex missing: '+pattern[:100])
    s=s2

rep('type RenderJob={id:string;status:string;progress:number;error:string|null;created_at:string;completed_at:string|null};\n','')
rep('const STEPS=[{key:"lead",label:"Lead"},{key:"enrich",label:"Enrichment"},{key:"page",label:"Landingpage"},{key:"video",label:"Video"},{key:"draft",label:"Entwurf"},{key:"review",label:"Prüfung"},{key:"send",label:"Versand"},{key:"engage",label:"Engagement"}];\nconst ACTIVE_RENDER=new Set(["queued","preparing","rendering","encoding","uploading"]);', 'const STEPS=[{key:"lead",label:"Lead"},{key:"contact",label:"Kontakt"},{key:"loom",label:"Loom"},{key:"mail",label:"Mail"},{key:"review",label:"Prüfung"},{key:"send",label:"Versand"},{key:"engage",label:"Reaktion"},{key:"close",label:"Abschluss"}];')
rep('function stageIndex(w:Workflow|null){return Math.max(0,Math.min(7,Number(w?.workflow_stage||1)-1))}', 'function stageIndex(w:Workflow|null){if(!w)return 0;if(w.replied)return 7;if(w.email_sent&&(w.email_opened||w.email_clicked||w.page_viewed||w.video_played||w.cta_clicked))return 6;if(w.email_sent)return 5;if(w.email_reviewed)return 4;if(w.email_draft_ready)return 3;if(w.video_ready)return 2;if(w.enrichment_status||w.contact_count>0)return 1;return 0}')
rep('const[lead,setLead]=useState<Lead|null>(null);const[followups,setFollowups]=useState<Followup[]>([]);const[activities,setActivities]=useState<Activity[]>([]);const[messages,setMessages]=useState<MessageRow[]>([]);const[flow,setFlow]=useState<FlowResponse>({workflow:null,contacts:[],page:null,draft:null,gates:null});const[renderJob,setRenderJob]=useState<RenderJob|null>(null);', 'const[lead,setLead]=useState<Lead|null>(null);const[followups,setFollowups]=useState<Followup[]>([]);const[activities,setActivities]=useState<Activity[]>([]);const[messages,setMessages]=useState<MessageRow[]>([]);const[flow,setFlow]=useState<FlowResponse>({workflow:null,contacts:[],page:null,draft:null,gates:null});')
rep('const[l,f,a,m,status,rj]=await Promise.all([', 'const[l,f,a,m,status]=await Promise.all([')
reg(r',supabase\.from\("energy_render_jobs"\)\.select\("id,status,progress,error,created_at,completed_at"\).*?\.maybeSingle\(\)\n  \]\);', '\n  ]);')
rep('if(!rj.error)setRenderJob((rj.data||null) as RenderJob|null);','')
reg(r'  useEffect\(\(\)=>\{const handler=\(event:Event\)=>\{const detail=\(event as CustomEvent<\{leadId\?:string;job\?:RenderJob\}>\).*?\},\[leadId,load\]\);\n','')
reg(r'  async function queueRender\(force=false\)\{.*?\n  async function sendReviewed', '  async function sendReviewed')
rep('  const renderActive=Boolean(renderJob&&ACTIVE_RENDER.has(renderJob.status)),renderProgress=Math.max(0,Math.min(100,renderJob?.progress||0));\n','')
rep('  const gateProblem=Boolean(w?.email_sent&&!w?.video_ready);const next=w?.recommended_action||lead.next_action||"Lead prüfen";const pageUrl=flow.page?.slug?`/v/${flow.page.slug}`:null;const watch=w?.max_watch_percent||0;', '  const gateProblem=Boolean(w?.email_sent&&!w?.video_ready);const next=!w?.enrichment_status&&!w?.contact_count?"Kontakte anreichern":!w?.video_ready?"Persönlichen Loom erstellen":!w?.email_draft_ready?"E-Mail-Entwurf erstellen":!w?.email_reviewed?"Entwurf prüfen & freigeben":!w?.email_sent?"Freigegebene E-Mail senden":w?.replied?"Antwort bearbeiten":w?.cta_clicked||w?.video_played&&Number(w?.max_watch_percent||0)>=75?"Jetzt anrufen":"Reaktion beobachten";const pageUrl=flow.page?.slug?`/v/${flow.page.slug}`:null;const watch=w?.max_watch_percent||0;')
rep('<div className={styles.eyebrow}>Lead Workspace · {w?.workflow_stage_label||"Lead angelegt"}</div>', '<div className={styles.eyebrow}>Lead Workspace · {STEPS[stage]?.label||"Lead"}</div>')
rep('<section className={styles.workflowCard}><div className={styles.workflowTop}><div><span>Produktions- & Vertriebsprozess</span><h2>{renderActive?`Automatischer Video-Render läuft · ${renderProgress}%`:next}</h2></div><div className={styles.percent}><strong>{w?.workflow_percent||12}%</strong><span>Workflow</span></div></div>', '<section className={styles.workflowCard}><div className={styles.workflowTop}><div><span>Produktions- & Vertriebsprozess</span><h2>{next}</h2></div><div className={styles.percent}><strong>{Math.round((stage+1)/STEPS.length*100)}%</strong><span>Workflow</span></div></div>')
p.write_text(s)
