import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={
  "content-type":"application/json",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods":"POST, OPTIONS",
};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const BUCKET="energy-media";
const SLIDE_TIMINGS:Record<number,[number,number]>={1:[14200,25200],2:[25200,36200],3:[36200,46200],4:[46200,58200],5:[58200,69200],6:[69200,82200],7:[82200,93200],8:[93200,107000]};

function env(){
  const url=Deno.env.get("SUPABASE_URL")!;
  const secs=Deno.env.get("SUPABASE_SECRET_KEYS");
  const secret=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!secret)throw new Error("Backend configuration missing");
  return{url,secret};
}
function admin(){const{url,secret}=env();return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
async function sha256(value:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function authorizedJob(db:ReturnType<typeof admin>,jobId:string,token:string){
  if(!jobId||!token||token.length<24)throw new Error("Render-Token fehlt");
  const{data:job,error}=await db.from("energy_render_jobs").select("*").eq("id",jobId).maybeSingle();
  if(error)throw error;
  if(!job)throw new Error("Render-Job nicht gefunden");
  const meta=job.metadata&&typeof job.metadata==="object"?job.metadata:{};
  const expected=String(meta.render_token_hash||"");
  const actual=await sha256(token);
  if(!expected||expected!==actual)throw new Error("Render-Token ungültig");
  const expires=Date.parse(String(meta.render_token_expires_at||""));
  if(!Number.isFinite(expires)||expires<Date.now())throw new Error("Render-Token abgelaufen");
  if(["completed","cancelled"].includes(String(job.status||"")))throw new Error(`Render-Job ist bereits ${job.status}`);
  return job;
}
function cleanMetadata(raw:any,extra:Record<string,unknown>={}){
  const next={...(raw&&typeof raw==="object"?raw:{}),...extra};
  delete next.render_token_hash;
  delete next.render_token_expires_at;
  return next;
}
function safeVariables(lead:any,page:any,brand:any){
  return{
    company:String(lead?.company_name||page?.company_name||"Unternehmen"),
    firstname:String(lead?.contact_name||page?.prospect_name||""),
    website:String(lead?.website||page?.website_url||""),
    city:String(lead?.city||""),
    industry:String(lead?.industry||""),
    problem:String(lead?.next_action||lead?.summary||page?.intro_text||""),
    opportunity:Number(lead?.total_score||0),
    roof_area:lead?.roof_area_m2??null,
    energy_score:lead?.energy_score??null,
    cta:String(brand?.defaultCtaLabel||page?.cta_label||"Termin über WhatsApp anfragen"),
  };
}
function slideNumber(item:any){
  const direct=Number(item?.metadata?.slide||0);
  if(direct>=1&&direct<=8)return direct;
  const m=String(item?.label||"").match(/Energiekosten\s*·\s*Clean\s*·\s*(0[1-8])/i);
  return m?Number(m[1]):0;
}
function validateEnergiekostenTimeline(items:any[],page:any){
  const forbidden=items.filter((item:any)=>!["website","presenter","audio","image"].includes(String(item?.type||"")));
  if(forbidden.length)throw new Error(`Energiekosten-Render enthält verbotene Layer: ${forbidden.map((x:any)=>x.type).join(", ")}`);
  const websites=items.filter((item:any)=>item?.type==="website");
  const presenters=items.filter((item:any)=>item?.type==="presenter");
  const slides=items.filter((item:any)=>item?.type==="image");
  if(websites.length!==1)throw new Error(`Energiekosten-Master benötigt exakt 1 Website-Layer, gefunden: ${websites.length}`);
  if(presenters.length!==1)throw new Error(`Energiekosten-Master benötigt exakt 1 B2B-Presenter, gefunden: ${presenters.length}`);
  if(slides.length!==8)throw new Error(`Energiekosten-Master unvollständig: ${slides.length}/8 Clean-HD-Slides`);
  const website=websites[0];
  const presenter=presenters[0];
  if(!website?.sourceUrl||String(website.sourceUrl)!==String(page.website_capture_url||""))throw new Error("Personalisierter Website-Screenshot ist nicht korrekt gebunden");
  if(Number(website.startMs)!==0||Number(website.endMs)!==14200)throw new Error("Website-Screenshot hat falsches Zeitfenster");
  if(String(presenter?.metadata?.audience||"")!=="b2b"||presenter?.metadata?.approved===false)throw new Error("B2B-Talking-Head fehlt");
  if(Number(presenter.startMs)!==0||Number(presenter.endMs)!==107000)throw new Error("B2B-Talking-Head hat falsches Zeitfenster");
  const seen=new Set<number>();
  for(const slide of slides){
    const n=slideNumber(slide);
    if(!n||seen.has(n))throw new Error("Clean-HD-Slides sind doppelt oder falsch nummeriert");
    seen.add(n);
    const expected=SLIDE_TIMINGS[n];
    if(Number(slide.startMs)!==expected[0]||Number(slide.endMs)!==expected[1])throw new Error(`Clean-HD-Slide ${n} hat falsches Zeitfenster`);
    if(slide?.metadata?.clean_original!==true||slide?.metadata?.approved!==true)throw new Error(`Clean-HD-Slide ${n} ist nicht freigegeben`);
    if(!/^Energiekosten\s*·\s*Clean\s*·\s*0[1-8]\s*·/i.test(String(slide.label||"")))throw new Error(`Clean-HD-Slide ${n} hat falsches Label`);
    if(!String(slide.sourceUrl||"").includes("/storage/v1/object/public/energy-media/")||!String(slide.sourceUrl||"").includes("/template-slides/"))throw new Error(`Clean-HD-Slide ${n} ist nicht an das freigegebene Storage-Asset gebunden`);
  }
  if(seen.size!==8)throw new Error(`Energiekosten-Master unvollständig: ${seen.size}/8 Clean-HD-Slides`);
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return out({error:"Method not allowed"},405);
  const db=admin();
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"manifest");
    const jobId=String(body?.jobId||"").trim();
    const token=String(body?.token||"").trim();
    const job=await authorizedJob(db,jobId,token);

    if(action==="validate")return out({ok:true,status:job.status,progress:Number(job.progress||0)});

    if(action==="manifest"){
      const[{data:page,error:pe},{data:lead,error:le}]=await Promise.all([
        db.from("energy_video_pages").select("id,lead_id,slug,company_name,prospect_name,website_url,presenter_video_url,website_capture_url,website_capture_status,website_capture_verified_at,website_capture_width,website_capture_height,headline,intro_text,cta_label,template_key,timeline_v3,studio_config,brand_kit_snapshot,studio_revision").eq("id",job.video_page_id).eq("user_id",job.user_id).maybeSingle(),
        db.from("energy_leads").select("id,company_name,contact_name,website,city,industry,roof_area_m2,energy_score,total_score,summary,next_action").eq("id",job.lead_id).eq("user_id",job.user_id).maybeSingle(),
      ]);
      if(pe||!page)throw pe||new Error("Video-Seite fehlt");
      if(le||!lead)throw le||new Error("Lead fehlt");
      const timeline=page.timeline_v3 as any;
      if(!timeline||Number(timeline.version)!==3||!Array.isArray(timeline.tracks))throw new Error("Finale Timeline fehlt");
      const items=timeline.tracks.flatMap((track:any)=>Array.isArray(track?.items)?track.items:[]).filter((item:any)=>!item?.hidden);
      if(String(page.template_key||"")==="energiekosten"){
        validateEnergiekostenTimeline(items,page);
        if(Number(page.website_capture_width||0)<1920||Number(page.website_capture_height||0)<1080||!["ready","verified"].includes(String(page.website_capture_status||"")))throw new Error("HD-Website-Screenshot ist nicht verifiziert");
        const{data:master,error:me}=await db.from("energy_studio_configs").select("autosave_revision,published_revision").eq("user_id",job.user_id).eq("scope","global").is("lead_id",null).eq("template_key","energiekosten").order("updated_at",{ascending:false}).limit(1).maybeSingle();
        if(me)throw me;
        if(!master||Number(master.autosave_revision)!==Number(master.published_revision)||Number(page.studio_revision)!==Number(master.autosave_revision))throw new Error("Video-Master ist veraltet oder nicht veröffentlicht");
      }
      const outputPath=`${job.user_id}/renders/${job.lead_id}/${job.id}.mp4`;
      const signed=await db.storage.from(BUCKET).createSignedUploadUrl(outputPath,{upsert:true});
      if(signed.error||!signed.data?.token)throw signed.error||new Error("Signierter Video-Upload konnte nicht erstellt werden");
      const now=new Date().toISOString();
      await db.from("energy_render_jobs").update({status:"preparing",progress:2,started_at:job.started_at||now,error:null,render_engine:"github-actions-headless-mp4",output_bucket:BUCKET,output_path:outputPath,updated_at:now}).eq("id",job.id);
      const brand=page.brand_kit_snapshot&&typeof page.brand_kit_snapshot==="object"?page.brand_kit_snapshot:{};
      return out({ok:true,jobId:job.id,pageId:page.id,leadId:lead.id,timeline,brand,variables:safeVariables(lead,page,brand),upload:{bucket:BUCKET,path:outputPath,token:signed.data.token}});
    }

    if(action==="progress"){
      const progress=Math.max(2,Math.min(96,Math.round(Number(body?.progress||0))));
      const status=progress>=95?"uploading":"rendering";
      await db.from("energy_render_jobs").update({status,progress,updated_at:new Date().toISOString()}).eq("id",job.id);
      return out({ok:true,status,progress});
    }

    if(action==="complete"){
      const path=String(job.output_path||`${job.user_id}/renders/${job.lead_id}/${job.id}.mp4`);
      const slash=path.lastIndexOf("/");
      const dir=path.slice(0,slash);
      const name=path.slice(slash+1);
      const listed=await db.storage.from(BUCKET).list(dir,{search:name,limit:10});
      if(listed.error)throw listed.error;
      const object=(listed.data||[]).find(x=>x.name===name);
      if(!object)throw new Error("Gerenderte MP4-Datei wurde nach Upload nicht gefunden");
      const publicUrl=db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const now=new Date().toISOString();
      const pageUpdate=await db.from("energy_video_pages").update({rendered_video_url:publicUrl,rendered_video_format:"mp4",rendered_at:now,updated_at:now}).eq("id",job.video_page_id).eq("user_id",job.user_id);
      if(pageUpdate.error)throw pageUpdate.error;
      const existing=await db.from("energy_media_assets").select("id").eq("user_id",job.user_id).contains("metadata",{render_job_id:job.id}).limit(1).maybeSingle();
      if(!existing.data){
        const asset=await db.from("energy_media_assets").insert({user_id:job.user_id,filename:`final-${job.lead_id}.mp4`,kind:"render",mime_type:"video/mp4",size_bytes:Number((object as any)?.metadata?.size||0)||null,storage_bucket:BUCKET,storage_path:path,label:"Finaler automatischer MP4-Render",metadata:{render_job_id:job.id,lead_id:job.lead_id,video_page_id:job.video_page_id,source:"github_actions_headless_mp4",width:Number(job.width||1920),height:Number(job.height||1080),template:"energiekosten",clean_hd_slides:8}});
        if(asset.error)throw asset.error;
      }
      const metadata=cleanMetadata(job.metadata,{render_completed_at:now,render_mode:"final_mp4_only",clean_hd_slides:8});
      const completed=await db.from("energy_render_jobs").update({status:"completed",progress:100,output_bucket:BUCKET,output_path:path,output_url:publicUrl,completed_at:now,error:null,locked_at:null,locked_by:null,metadata,updated_at:now}).eq("id",job.id);
      if(completed.error)throw completed.error;
      await db.from("energy_activities").insert({user_id:job.user_id,lead_id:job.lead_id,activity_type:"video_rendered",title:"Finales MP4 automatisch gerendert",detail:"Website, acht freigegebene Clean-HD-Slides und B2B-Talking-Head wurden zu einer einzelnen MP4-Datei gerendert.",metadata:{render_job_id:job.id,video_page_id:job.video_page_id,output_url:publicUrl,clean_hd_slides:8}});
      return out({ok:true,status:"completed",outputUrl:publicUrl});
    }

    if(action==="fail"){
      const message=String(body?.error||"Rendering fehlgeschlagen").slice(0,700);
      const now=new Date().toISOString();
      const metadata=cleanMetadata(job.metadata,{render_failed_at:now});
      await db.from("energy_render_jobs").update({status:"failed",error:message,completed_at:now,locked_at:null,locked_by:null,metadata,updated_at:now}).eq("id",job.id);
      return out({ok:true,status:"failed"});
    }

    return out({error:"Unbekannte Aktion"},400);
  }catch(error){
    const message=error instanceof Error?error.message:"Render orchestration error";
    const status=/Token|nicht gefunden|abgelaufen|bereits/.test(message)?403:500;
    return out({error:message.slice(0,700)},status);
  }
});