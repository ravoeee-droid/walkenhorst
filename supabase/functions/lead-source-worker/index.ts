import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"content-type,x-worker-key","access-control-allow-methods":"POST,OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const UA="Walkenhorst-Energy-Radar/1.1 (low-frequency business lead research; contact: info@walkenhorst-eko.de)";
const OVERPASS=["https://overpass-api.de/api/interpreter","https://overpass.private.coffee/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const LOCATIONS=["Stuttgart","München","Nürnberg","Mannheim","Frankfurt am Main","Köln","Düsseldorf","Dortmund","Bielefeld","Hannover","Bremen","Hamburg","Leipzig","Dresden","Berlin","Karlsruhe","Freiburg im Breisgau","Ulm","Augsburg","Heilbronn","Münster"];
const FILTER_SETS=[
  {industry:"Produktion",filters:['["industrial"]','["man_made"="works"]']},
  {industry:"Logistik / Lager",filters:['["industrial"="logistics"]','["building"="warehouse"]','["office"="logistics"]']},
  {industry:"Hotel",filters:['["tourism"="hotel"]']},
  {industry:"Handel",filters:['["shop"="wholesale"]','["building"="retail"]']},
];

type DB=ReturnType<typeof admin>;
type Element={id:number;type:string;lat?:number;lon?:number;center?:{lat:number;lon:number};tags?:Record<string,string>};
function env(){const url=Deno.env.get("SUPABASE_URL")||"";const keys=Deno.env.get("SUPABASE_SECRET_KEYS");const secret=keys?JSON.parse(keys)?.default:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!secret)throw new Error("Backend configuration missing");return{url,secret:String(secret)}}
function admin(){const e=env();return createClient(e.url,e.secret,{auth:{persistSession:false,autoRefreshToken:false}})}
async function authorized(req:Request,db:DB){const supplied=req.headers.get("x-worker-key")||"";if(!supplied)return false;const{data}=await db.rpc("energy_get_system_secret",{p_name:"energy_worker_key"});return Boolean(data&&String(data)===supplied)}
function clean(v:unknown){return String(v||"").trim()}
function first(t:Record<string,string>,keys:string[]){for(const k of keys){const v=clean(t[k]);if(v)return v}return""}
function website(v:string){if(!v)return"";return /^https?:\/\//i.test(v)?v:`https://${v}`}
function domain(v:string){try{return new URL(v).hostname.replace(/^www\./,"").toLowerCase()}catch{return""}}
function addr(t:Record<string,string>){return[t["addr:street"],t["addr:housenumber"]].filter(Boolean).join(" ")}
function quality(x:{website:string;email:string;phone:string;address:string;postcode:string}){return Math.min(100,20+(x.website?30:0)+(x.email?25:0)+(x.phone?15:0)+(x.address?5:0)+(x.postcode?5:0))}
async function geocode(place:string){const u=new URL("https://nominatim.openstreetmap.org/search");u.searchParams.set("q",place);u.searchParams.set("format","jsonv2");u.searchParams.set("limit","1");u.searchParams.set("countrycodes","de");const r=await fetch(u,{headers:{"User-Agent":UA,"Accept-Language":"de"},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`geocode_${r.status}`);const j=await r.json() as Array<{lat:string;lon:string;display_name:string}>;if(!j[0])throw new Error("geocode_empty");return{lat:Number(j[0].lat),lon:Number(j[0].lon),label:j[0].display_name}}
async function overpass(q:string){const errors:string[]=[];for(const endpoint of OVERPASS){try{const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8","User-Agent":UA},body:new URLSearchParams({data:q}),signal:AbortSignal.timeout(22000)});if(r.ok)return{payload:await r.json() as{elements?:Element[]},endpoint,errors};errors.push(`${new URL(endpoint).hostname}:${r.status}`)}catch(e){errors.push(`${new URL(endpoint).hostname}:${e instanceof Error?e.name:"error"}`)}}throw new Error(`overpass_unavailable:${errors.join(",")}`)}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
  if(req.method!=="POST")return out({error:"Method not allowed"},405);
  const db=admin();if(!(await authorized(req,db)))return out({error:"Nicht autorisiert"},401);
  const body=await req.json().catch(()=>({}));const threshold=Math.max(100,Math.min(2000,Number(body?.threshold)||500));const limit=Math.max(5,Math.min(50,Number(body?.limit)||25));
  const{data:campaign}=await db.from("energy_campaigns").select("id,user_id,lead_filter").eq("status","active").order("created_at",{ascending:false}).limit(10);
  const commercial=(campaign||[]).find((c:any)=>String(c?.lead_filter?.customerType||"commercial")==="commercial");if(!commercial)return out({ok:true,skipped:"no_active_commercial_campaign"});
  const userId=String(commercial.user_id);
  const{count}=await db.from("energy_leads").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("customer_type","commercial").eq("do_not_contact",false).is("last_contact_at",null).neq("email_status","invalid").in("status",["new","research","ready"]);
  if((count||0)>=threshold)return out({ok:true,skipped:"pool_healthy",available:count,threshold});

  const slot=Math.floor(Date.now()/21600000);const place=LOCATIONS[slot%LOCATIONS.length];const set=FILTER_SETS[Math.floor(slot/LOCATIONS.length)%FILTER_SETS.length];const geo=await geocode(place);const radius=25000;
  const blocks=set.filters.flatMap(f=>[`node(around:${radius},${geo.lat},${geo.lon})${f};`,`way(around:${radius},${geo.lat},${geo.lon})${f};`,`relation(around:${radius},${geo.lat},${geo.lon})${f};`]).join("\n");
  const q=`[out:json][timeout:20];(${blocks});out center tags ${Math.min(250,limit*8)};`;const result=await overpass(q);const candidates:any[]=[];const seen=new Set<string>();
  for(const el of result.payload.elements||[]){const t=el.tags||{};const name=first(t,["name","brand","operator"]);if(!name)continue;const web=website(first(t,["contact:website","website","url"]));const email=first(t,["contact:email","email"]);const phone=first(t,["contact:phone","phone","contact:mobile"]);if(!web&&!email&&!phone)continue;const city=first(t,["addr:city","addr:place"])||place;const external=`${el.type}/${el.id}`;const key=domain(web)||`${name.toLowerCase()}|${city.toLowerCase()}`;if(seen.has(key))continue;seen.add(key);const address=addr(t),postcode=first(t,["addr:postcode"]);const score=quality({website:web,email,phone,address,postcode});if(score<45)continue;candidates.push({user_id:userId,company_name:name,website:web||null,city,industry:set.industry,phone:phone||null,email:email||null,address:address||null,postcode:postcode||null,country:"DE",source:"openstreetmap_auto",source_external_id:external,source_url:`https://www.openstreetmap.org/${external}`,status:"research",customer_type:"commercial",video_template_key:"energiekosten",contactability_score:Math.min(100,score),total_score:0,summary:`Automatisch gefundener Gewerbe-Lead aus OpenStreetMap · ${set.industry} · ${place}`,next_action:"Daten anreichern",metadata:{lead_source_worker:true,quality_score:score,source_provider:new URL(result.endpoint).hostname,lat:el.lat??el.center?.lat??null,lon:el.lon??el.center?.lon??null}});if(candidates.length>=limit*2)break}
  if(!candidates.length)return out({ok:true,imported:0,location:geo.label,industry:set.industry,provider:new URL(result.endpoint).hostname});
  const externalIds=candidates.map(x=>x.source_external_id);const{data:existing}=await db.from("energy_leads").select("source_external_id").eq("user_id",userId).in("source_external_id",externalIds);const exists=new Set((existing||[]).map((x:any)=>String(x.source_external_id||"")));const fresh=candidates.filter(x=>!exists.has(x.source_external_id)).slice(0,limit);
  let imported=0;if(fresh.length){const ins=await db.from("energy_leads").insert(fresh).select("id");if(ins.error)throw ins.error;imported=ins.data?.length||0}
  return out({ok:true,available_before:count,threshold,location:geo.label,industry:set.industry,provider:new URL(result.endpoint).hostname,fallback_errors:result.errors,found:candidates.length,imported});
});
