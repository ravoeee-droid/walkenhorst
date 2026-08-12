import { NextRequest, NextResponse } from "next/server";

type OsmElement = { id:number; type:string; lat?:number; lon?:number; center?:{lat:number;lon:number}; tags?:Record<string,string> };

const USER_AGENT = "Walkenhorst-Energy-Radar/1.0 (business lead research; contact: info@walkenhorst-eko.de)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

const TAG_FILTERS: Record<string,string[]> = {
  logistik: ['["industrial"="logistics"]','["building"="warehouse"]','["office"="logistics"]'],
  lager: ['["building"="warehouse"]','["industrial"]'],
  produktion: ['["industrial"]','["man_made"="works"]','["craft"]'],
  industrie: ['["industrial"]','["man_made"="works"]'],
  hotel: ['["tourism"="hotel"]'],
  pflege: ['["amenity"="nursing_home"]','["social_facility"="nursing_home"]'],
  autohaus: ['["shop"="car"]'],
  fitness: ['["leisure"="fitness_centre"]'],
  supermarkt: ['["shop"="supermarket"]'],
  handel: ['["shop"]'],
  gastronomie: ['["amenity"="restaurant"]','["amenity"="fast_food"]'],
  landwirtschaft: ['["landuse"="farmyard"]','["building"="farm_auxiliary"]'],
};

function safeRadius(value: unknown) { const n=Number(value); return Number.isFinite(n)?Math.max(1,Math.min(50,Math.round(n))):20; }
function clean(value:string|undefined){return String(value||"").trim();}
function chooseFilters(industry:string,query:string){const key=`${industry} ${query}`.toLowerCase();for(const [needle,filters] of Object.entries(TAG_FILTERS))if(key.includes(needle))return filters;return ['["office"]["name"]','["industrial"]["name"]','["shop"]["name"]','["craft"]["name"]'];}
function address(tags:Record<string,string>){return [tags["addr:street"],tags["addr:housenumber"]].filter(Boolean).join(" ");}
function first(tags:Record<string,string>,keys:string[]){for(const key of keys)if(clean(tags[key]))return clean(tags[key]);return "";}
function normalizeWebsite(value:string){if(!value)return "";return /^https?:\/\//i.test(value)?value:`https://${value}`;}

export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    const location=clean(body?.location);
    const industry=clean(body?.industry);
    const query=clean(body?.query);
    const radiusKm=safeRadius(body?.radiusKm);
    const limit=Math.max(5,Math.min(100,Number(body?.limit)||50));
    if(!location)return NextResponse.json({error:"Bitte Ort oder Region angeben."},{status:400});

    const geoUrl=new URL(NOMINATIM);geoUrl.searchParams.set("q",location);geoUrl.searchParams.set("format","jsonv2");geoUrl.searchParams.set("limit","1");geoUrl.searchParams.set("countrycodes","de");
    const geo=await fetch(geoUrl,{headers:{"User-Agent":USER_AGENT,"Accept-Language":"de"},next:{revalidate:86400}});
    if(!geo.ok)throw new Error(`Geocoding fehlgeschlagen (${geo.status})`);
    const places=await geo.json() as Array<{lat:string;lon:string;display_name:string}>;
    if(!places[0])return NextResponse.json({error:"Ort wurde nicht gefunden."},{status:404});
    const lat=Number(places[0].lat),lon=Number(places[0].lon),radius=radiusKm*1000;
    const filters=chooseFilters(industry,query);
    const blocks=filters.flatMap(filter=>[`node(around:${radius},${lat},${lon})${filter};`,`way(around:${radius},${lat},${lon})${filter};`,`relation(around:${radius},${lat},${lon})${filter};`]).join("\n");
    const overpassQuery=`[out:json][timeout:25];( ${blocks} );out center tags ${Math.min(250,limit*4)};`;
    const over=await fetch(OVERPASS,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8","User-Agent":USER_AGENT},body:new URLSearchParams({data:overpassQuery}),cache:"no-store"});
    if(!over.ok)throw new Error(`Lead-Suche ist gerade ausgelastet (${over.status})`);
    const payload=await over.json() as {elements:OsmElement[]};
    const seen=new Set<string>();
    const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
    const results=(payload.elements||[]).map(el=>{
      const t=el.tags||{};const name=first(t,["name","brand","operator"]);if(!name)return null;
      const website=normalizeWebsite(first(t,["contact:website","website","url"]));
      const phone=first(t,["contact:phone","phone","contact:mobile"]);
      const email=first(t,["contact:email","email"]);
      const city=first(t,["addr:city","addr:place"]);
      const category=first(t,["industrial","office","shop","craft","tourism","amenity","leisure","building"]);
      const hay=`${name} ${category} ${t.description||""}`.toLowerCase();
      const match=!terms.length||terms.some(term=>hay.includes(term))||industry.length>0;
      if(!match)return null;
      const key=`${name.toLowerCase()}|${city.toLowerCase()}|${website.toLowerCase()}`;if(seen.has(key))return null;seen.add(key);
      return {company_name:name,website:website||null,city:city||location,industry:industry||category||null,address:address(t)||null,postcode:first(t,["addr:postcode"])||null,phone:phone||null,email:email||null,source:"openstreetmap",source_external_id:`${el.type}/${el.id}`,source_url:`https://www.openstreetmap.org/${el.type}/${el.id}`,lat:el.lat??el.center?.lat??null,lon:el.lon??el.center?.lon??null};
    }).filter(Boolean).slice(0,limit);
    return NextResponse.json({results,count:results.length,location:places[0].display_name,attribution:"© OpenStreetMap contributors · ODbL"});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Lead Finder fehlgeschlagen."},{status:500});}
}
