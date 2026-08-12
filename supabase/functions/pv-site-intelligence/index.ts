import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const NOMINATIM="https://nominatim.openstreetmap.org/search";
const PVGIS="https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";

function env(){const url=Deno.env.get("SUPABASE_URL")||"";const pubs=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");const secs=Deno.env.get("SUPABASE_SECRET_KEYS");const publicKey=pubs?JSON.parse(pubs)?.default:Deno.env.get("SUPABASE_ANON_KEY");const secretKey=secs?JSON.parse(secs)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!publicKey||!secretKey)throw new Error("Backend configuration missing");return{url,publicKey,secretKey}}
function admin(){const e=env();return createClient(e.url,e.secretKey,{auth:{persistSession:false,autoRefreshToken:false}})}
async function user(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return null;const e=env();const c=createClient(e.url,e.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});const{data,error}=await c.auth.getUser(token);return error?null:data.user}
function num(v:unknown){const n=Number(v);return Number.isFinite(n)?n:null}
function clamp(v:unknown,min:number,max:number,fallback:number){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
async function fetchTimeout(url:string,init:RequestInit={},ms=15000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);try{return await fetch(url,{...init,signal:controller.signal})}finally{clearTimeout(timer)}}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const u=await user(req);if(!u)return out({error:"Nicht autorisiert"},401);const b=await req.json().catch(()=>({}));const leadId=String(b?.leadId||"").trim();if(!leadId)return out({error:"Lead fehlt"},400);const db=admin();
  const{data:lead,error:leadError}=await db.from("energy_leads").select("id,user_id,company_name,address,postcode,city,roof_area_m2").eq("id",leadId).eq("user_id",u.id).maybeSingle();if(leadError)throw leadError;if(!lead)return out({error:"Lead nicht gefunden"},404);
  let lat=num(b?.latitude),lon=num(b?.longitude),geoSource="manual_coordinates",geoLabel:string|null=null;
  if(lat===null||lon===null){
    const q=[lead.address,lead.postcode,lead.city,"Deutschland"].filter(Boolean).join(", ");if(!q)return out({error:"Für automatische Geocodierung fehlen Adresse/PLZ/Ort. Alternativ Koordinaten eingeben."},400);
    const url=new URL(NOMINATIM);url.searchParams.set("q",q);url.searchParams.set("format","jsonv2");url.searchParams.set("limit","1");url.searchParams.set("countrycodes","de");
    const r=await fetchTimeout(url.toString(),{headers:{"User-Agent":"Walkenhorst-Energy-Radar/1.0 (site intelligence)","Accept-Language":"de"}},12000);if(!r.ok)throw new Error(`Geocoding HTTP ${r.status}`);const rows=await r.json() as Array<{lat:string;lon:string;display_name:string}>;if(!rows[0])return out({error:"Standort konnte nicht eindeutig geocodiert werden. Bitte Koordinaten manuell eingeben."},404);lat=Number(rows[0].lat);lon=Number(rows[0].lon);geoSource="nominatim";geoLabel=rows[0].display_name;
  }
  if(lat===null||lon===null||lat<-90||lat>90||lon<-180||lon>180)return out({error:"Ungültige Koordinaten"},400);
  const pvgis=new URL(PVGIS);pvgis.searchParams.set("lat",String(lat));pvgis.searchParams.set("lon",String(lon));pvgis.searchParams.set("peakpower","1");pvgis.searchParams.set("loss","14");pvgis.searchParams.set("optimalangles","1");pvgis.searchParams.set("outputformat","json");
  const pr=await fetchTimeout(pvgis.toString(),{headers:{"User-Agent":"Walkenhorst-Energy-Radar/1.0","Accept":"application/json"}},20000);if(!pr.ok){const text=(await pr.text()).slice(0,500);throw new Error(`PVGIS HTTP ${pr.status}: ${text}`)}const pv=await pr.json();const totals=pv?.outputs?.totals?.fixed||{};const yieldPerKwp=num(totals?.E_y);const irradiation=num(totals?.["H(i)_y"]);if(yieldPerKwp===null)throw new Error("PVGIS lieferte keinen Jahresertrag für den Standort.");
  const slope=num(pv?.inputs?.mounting_system?.fixed?.slope?.value??pv?.inputs?.mounting_system?.fixed?.slope);const azimuth=num(pv?.inputs?.mounting_system?.fixed?.azimuth?.value??pv?.inputs?.mounting_system?.fixed?.aspect?.value??pv?.inputs?.mounting_system?.fixed?.azimuth);
  const roof=num(b?.roofAreaM2)??num(lead.roof_area_m2);const usableFactor=clamp(b?.usableRoofFactor,0.3,0.9,0.65);const density=clamp(b?.kwpPerUsableM2,0.15,0.25,0.20);const capacity=roof&&roof>0?roof*usableFactor*density:null;const annual=capacity!==null?capacity*yieldPerKwp:null;const now=new Date().toISOString();const status=capacity!==null?"ready":"partial";
  const assumptions={benchmark:"PVGIS 1 kWp with optimal angles",system_loss_pct:14,usable_roof_factor:usableFactor,kwp_per_usable_m2:density,roof_geometry_verified:false,shading_verified:false,grid_connection_verified:false};
  const{data:saved,error:saveError}=await db.from("energy_site_intelligence").upsert({user_id:u.id,lead_id:lead.id,provider:"pvgis",latitude:lat,longitude:lon,geo_source:geoSource,geo_label:geoLabel,roof_area_m2:roof,pv_yield_kwh_per_kwp:yieldPerKwp,irradiation_kwh_m2:irradiation,optimal_slope_deg:slope,optimal_azimuth_deg:azimuth,estimated_capacity_kwp:capacity,estimated_annual_generation_kwh:annual,assumptions,status,error:null,analyzed_at:now,updated_at:now},{onConflict:"user_id,lead_id"}).select("*").single();if(saveError)throw saveError;
  if(roof&&roof>0)await db.from("energy_leads").update({roof_area_m2:roof,updated_at:now}).eq("id",lead.id).eq("user_id",u.id);
  await db.from("energy_activities").insert({user_id:u.id,lead_id:lead.id,activity_type:"pv_site_intelligence",title:"PV-Standortpotenzial analysiert",detail:`${Math.round(yieldPerKwp)} kWh/kWp·a Standort-Benchmark${capacity!==null?` · ca. ${capacity.toFixed(1)} kWp aus Flächenannahme`:" · Dachfläche noch offen"}`,metadata:{site_intelligence_id:saved.id,provider:"pvgis",latitude:lat,longitude:lon}});
  return out({ok:true,site:saved,disclaimer:"Standort-Benchmark und Flächenmodell. Keine Dach-, Verschattungs-, Statik-, Netz- oder Wirtschaftlichkeitsprüfung."});
 }catch(e){return out({error:e instanceof Error?e.message.slice(0,900):"PV Site Intelligence fehlgeschlagen"},500)}
});
