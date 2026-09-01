import { after } from "next/server";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

const CHROMIUM_PACK_URL="https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

async function orchestrate(action:string,jobId:string,token:string,extra:Record<string,unknown>={}){
  const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!base||!key)throw new Error("Supabase-Konfiguration fehlt");
  const response=await fetch(`${base}/functions/v1/render-orchestrator`,{method:"POST",headers:{"content-type":"application/json",apikey:key,authorization:`Bearer ${key}`},body:JSON.stringify({action,jobId,token,...extra}),cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error)throw new Error(String(data?.error||`Render-Orchestrator HTTP ${response.status}`));
  return data;
}

async function runHeadlessRender(origin:string,jobId:string,token:string){
  let browser:Awaited<ReturnType<typeof puppeteer.launch>>|null=null;
  try{
    const executablePath=process.env.CHROMIUM_EXECUTABLE_PATH||await chromium.executablePath(process.env.CHROMIUM_PACK_URL||CHROMIUM_PACK_URL);
    const args=await puppeteer.defaultArgs({args:[...chromium.args,"--autoplay-policy=no-user-gesture-required","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows"],headless:"shell"});
    browser=await puppeteer.launch({args,executablePath,headless:"shell",defaultViewport:{width:1440,height:900,deviceScaleFactor:1}});
    const page=await browser.newPage();
    page.on("console",message=>console.log(`[render:${jobId}]`,message.type(),message.text()));
    page.on("pageerror",error=>console.error(`[render:${jobId}] pageerror`,error instanceof Error?error.message:String(error)));
    const renderUrl=`${origin}/v/internal-render/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`;
    const response=await page.goto(renderUrl,{waitUntil:"domcontentloaded",timeout:60000});
    if(!response||response.status()>=400)throw new Error(`Render-Seite antwortet mit HTTP ${response?.status()||"unbekannt"}`);
    await page.waitForFunction(()=>["completed","failed"].includes(document.documentElement.dataset.renderStatus||""),{timeout:280000,polling:1000});
    const state=await page.evaluate(()=>({status:document.documentElement.dataset.renderStatus||"",error:document.documentElement.dataset.renderError||""}));
    if(state.status!=="completed")throw new Error(state.error||"Headless-Render fehlgeschlagen");
    console.log(`[render:${jobId}] completed`);
  }catch(error){
    const message=error instanceof Error?error.message:"Headless-Render fehlgeschlagen";
    console.error(`[render:${jobId}] failed`,message);
    await orchestrate("fail",jobId,token,{error:message}).catch(()=>undefined);
  }finally{
    await browser?.close().catch(()=>undefined);
  }
}

async function start(request:Request,{params}:{params:Promise<{jobId:string}>}){
  const{jobId}=await params;
  const url=new URL(request.url);
  let token=url.searchParams.get("token")||"";
  if(request.method==="POST"&&!token){
    const body=await request.json().catch(()=>({}));
    token=String(body?.token||"");
  }
  if(!jobId||!token)return Response.json({error:"Render-Token fehlt"},{status:400,headers:{"cache-control":"no-store"}});
  try{
    const validation=await orchestrate("validate",jobId,token);
    if(validation.status==="completed")return Response.json({ok:true,status:"completed"},{headers:{"cache-control":"no-store"}});
    const origin=url.origin;
    after(runHeadlessRender(origin,jobId,token));
    return Response.json({ok:true,status:"started",jobId},{status:202,headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Render konnte nicht gestartet werden"},{status:403,headers:{"cache-control":"no-store"}});
  }
}

export const GET=start;
export const POST=start;