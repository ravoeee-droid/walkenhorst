export type StudioV3AspectRatio="16:9"|"9:16"|"1:1"|"4:5";
export type StudioV3TrackType="background"|"media"|"presenter"|"overlay"|"text"|"audio";
export type StudioV3ItemType="video"|"image"|"website"|"presenter"|"text"|"shape"|"metric"|"logo"|"map"|"audio";
export type StudioV3Animation="none"|"fade"|"slide-up"|"slide-left"|"zoom"|"pop";
export type StudioV3Transition="cut"|"fade"|"crossfade";
export type StudioV3ObjectFit="cover"|"contain"|"fill";
export type StudioV3LandingBlockType="hero"|"video"|"findings"|"metrics"|"trust"|"about"|"logos"|"proof"|"qualification"|"cta"|"calendar"|"faq"|"footer";

export type StudioV3Transform={x:number;y:number;width:number;height:number;rotation:number;opacity:number;borderRadius:number;scale:number};
export type StudioV3Keyframe={atMs:number;x?:number;y?:number;scale?:number;opacity?:number;scrollY?:number;cropX?:number;cropY?:number;cropWidth?:number;cropHeight?:number};
export type StudioV3Item={
 id:string;type:StudioV3ItemType;label:string;trackId:string;startMs:number;endMs:number;zIndex:number;locked?:boolean;hidden?:boolean;
 assetId?:string;sourceUrl?:string;dynamicSource?:"presenter"|"website_capture"|"logo"|"portrait"|"map";text?:string;subtext?:string;
 transform:StudioV3Transform;fit?:StudioV3ObjectFit;volume?:number;muted?:boolean;playbackRate?:number;color?:string;backgroundColor?:string;
 fontSize?:number;fontWeight?:number;textAlign?:"left"|"center"|"right";fontFamily?:string;lineHeight?:number;
 borderColor?:string;borderWidth?:number;shadow?:"none"|"soft"|"strong";shape?:"rectangle"|"circle"|"line"|"highlight";
 animationIn?:StudioV3Animation;animationOut?:StudioV3Animation;transition?:StudioV3Transition;animationDurationMs?:number;
 keyframes?:StudioV3Keyframe[];metadata?:Record<string,unknown>;
};
export type StudioV3Track={id:string;name:string;type:StudioV3TrackType;zIndex:number;locked:boolean;hidden:boolean;muted?:boolean;color?:string;items:StudioV3Item[]};
export type StudioV3Timeline={version:3;durationMs:number;fps:number;aspectRatio:StudioV3AspectRatio;width:number;height:number;backgroundColor:string;tracks:StudioV3Track[]};

export type StudioV3BrandKit={
 id?:string;name:string;websiteUrl:string;logoUrl:string;logoAssetId?:string;faviconUrl?:string;portraitUrl?:string;portraitAssetId?:string;
 primaryColor:string;secondaryColor:string;accentColor:string;backgroundColor:string;surfaceColor:string;textColor:string;mutedTextColor:string;buttonTextColor:string;
 fontHeading:string;fontBody:string;radiusPx:number;shadowStyle:"none"|"soft"|"strong";defaultCtaLabel:string;defaultCtaUrl:string;
 trustHeadline:string;trustBody:string;contactName:string;contactPhone:string;contactEmail:string;metadata:Record<string,unknown>;
};
export type StudioV3LandingBlock={id:string;type:StudioV3LandingBlockType;enabled:boolean;order:number;variant?:string;headline?:string;body?:string;eyebrow?:string;ctaLabel?:string;ctaUrl?:string;items?:Array<Record<string,unknown>>;style:{background?:string;textColor?:string;accentColor?:string;paddingY?:number;maxWidth?:number;radius?:number;align?:"left"|"center"};settings?:Record<string,unknown>};
export type StudioV3LandingConfig={version:3;theme:"walkenhorst"|"light"|"dark";showLogo:boolean;stickyCta:boolean;blocks:StudioV3LandingBlock[]};
export type StudioV3Project={version:3;name:string;presetKey:string;timeline:StudioV3Timeline;landing:StudioV3LandingConfig;brandKitId?:string;updatedAt?:string};

export type StudioV3LeadVariables={company?:string|null;firstname?:string|null;website?:string|null;city?:string|null;industry?:string|null;problem?:string|null;opportunity?:string|number|null;roof_area?:string|number|null;pv_kwp?:string|number|null;pv_yield?:string|number|null;energy_score?:string|number|null;saving_estimate?:string|number|null;cta?:string|null};

export const WALKENHORST_OFFICIAL_LOGO_URL="https://walkenhorst-energie.de/files/merconisfiles/themes/theme10/images/logos/logo-walkenhorst-black.svg";
export const WALKENHORST_OFFICIAL_PORTRAIT_URL="https://walkenhorst-energie.de/files/merconisfiles/themes/theme10/images/main/startseite-andreas.png";
export const STUDIO_V3_VARIABLES=["{{company}}","{{firstname}}","{{website}}","{{city}}","{{industry}}","{{problem}}","{{opportunity}}","{{roof_area}}","{{pv_kwp}}","{{pv_yield}}","{{energy_score}}","{{saving_estimate}}","{{cta}}"] as const;

export const WALKENHORST_BRAND_DEFAULT:StudioV3BrandKit={
 name:"Walkenhorst Energie",websiteUrl:"https://walkenhorst-energie.de/",logoUrl:WALKENHORST_OFFICIAL_LOGO_URL,portraitUrl:WALKENHORST_OFFICIAL_PORTRAIT_URL,
 primaryColor:"#111111",secondaryColor:"#F4F1EA",accentColor:"#D9A928",backgroundColor:"#FFFFFF",surfaceColor:"#F7F5F0",textColor:"#151515",mutedTextColor:"#6F716F",buttonTextColor:"#FFFFFF",
 fontHeading:"Arial, Helvetica, sans-serif",fontBody:"Arial, Helvetica, sans-serif",radiusPx:12,shadowStyle:"soft",defaultCtaLabel:"Kostenloses Erstgespräch anfragen",defaultCtaUrl:"https://walkenhorst-energie.de/kontakt",
 trustHeadline:"Ihre Energiezukunft ist meine Expertise.",trustBody:"Persönliche Energieberatung mit über 30 Jahren Beratungserfahrung und 10 Jahren Spezialisierung auf die Energiebranche.",contactName:"Andreas Walkenhorst",contactPhone:"0160 92414766",contactEmail:"info@walkenhorst-energie.de",metadata:{source:"walkenhorst-energie.de",positioning:["Maximale Unabhängigkeit","Spürbare Ersparnis","Strategische Effizienz","ROI","Wettbewerbsvorteil"]}
};

export const STUDIO_V3_PRESETS=[
 {key:"pv-gewerbe",label:"PV Gewerbe",headline:"{{company}}: ungenutztes Energiepotenzial sichtbar machen",problem:"Eigenverbrauch, Dachfläche und Stromkosten"},
 {key:"energiekosten",label:"Energiekosten",headline:"3 Hebel, mit denen {{company}} Energiekosten systematisch prüfen kann",problem:"Strom- und Erdgasverträge, Verbrauch und Beschaffung"},
 {key:"dachflaeche",label:"Dach & PV",headline:"Was die Fläche von {{company}} energetisch leisten könnte",problem:"Dachfläche, PV-Leistung und Eigenverbrauch"},
 {key:"energieaudit",label:"Energieaudit",headline:"Kurze Effizienz-Analyse für {{company}}",problem:"Energieaudit, Effizienz und Förderfähigkeit"},
 {key:"foerderung",label:"Förderung",headline:"Energie-Investitionen bei {{company}} intelligenter priorisieren",problem:"Förderung, Investition und Wirtschaftlichkeit"}
] as const;

export function studioV3Id(prefix:string){return `${prefix}-${crypto.randomUUID()}`}
export function clampStudio(value:number,min:number,max:number){return Math.min(Math.max(Number.isFinite(value)?value:min,min),max)}
export function studioV3Resolution(ratio:StudioV3AspectRatio){if(ratio==="9:16")return{width:1080,height:1920};if(ratio==="1:1")return{width:1080,height:1080};if(ratio==="4:5")return{width:1080,height:1350};return{width:1920,height:1080}}
export function studioV3Transform(patch:Partial<StudioV3Transform>={}):StudioV3Transform{return{x:0,y:0,width:100,height:100,rotation:0,opacity:1,borderRadius:0,scale:1,...patch}}

function item(input:Partial<StudioV3Item>&Pick<StudioV3Item,"id"|"type"|"label"|"trackId"|"startMs"|"endMs"|"zIndex">):StudioV3Item{return{transform:studioV3Transform(),fit:"cover",volume:1,playbackRate:1,animationIn:"fade",animationOut:"fade",transition:"cut",animationDurationMs:350,shadow:"none",...input}}
export function defaultStudioV3Timeline():StudioV3Timeline{
 const durationMs=85000;return{version:3,durationMs,fps:30,aspectRatio:"16:9",width:1920,height:1080,backgroundColor:"#0C0D0C",tracks:[
  {id:"track-bg",name:"Hintergrund",type:"background",zIndex:10,locked:false,hidden:false,color:"#30463A",items:[item({id:"website-1",type:"website",label:"Unternehmenswebsite",trackId:"track-bg",startMs:0,endMs:18000,zIndex:10,dynamicSource:"website_capture",keyframes:[{atMs:0,scrollY:0,scale:1},{atMs:9000,scrollY:28,scale:1.03},{atMs:17500,scrollY:58,scale:1.05}]}),item({id:"website-2",type:"website",label:"Website Details",trackId:"track-bg",startMs:36000,endMs:62000,zIndex:10,dynamicSource:"website_capture",keyframes:[{atMs:36000,scrollY:38,scale:1.08},{atMs:50000,scrollY:68,scale:1.12},{atMs:61500,scrollY:78,scale:1.08}]})]},
  {id:"track-presenter",name:"Andreas / Sprecher",type:"presenter",zIndex:40,locked:false,hidden:false,color:"#D9A928",items:[item({id:"presenter-intro",type:"presenter",label:"Andreas Intro",trackId:"track-presenter",startMs:0,endMs:8500,zIndex:40,dynamicSource:"presenter",transform:studioV3Transform({x:0,y:0,width:100,height:100}),metadata:{mode:"fullscreen"}}),item({id:"presenter-bubble",type:"presenter",label:"Talking Head",trackId:"track-presenter",startMs:8500,endMs:70000,zIndex:45,dynamicSource:"presenter",transform:studioV3Transform({x:76,y:66,width:20,height:30,borderRadius:100}),metadata:{mode:"bubble"}}),item({id:"presenter-close",type:"presenter",label:"Andreas CTA",trackId:"track-presenter",startMs:70000,endMs:85000,zIndex:40,dynamicSource:"presenter",transform:studioV3Transform({x:0,y:0,width:100,height:100}),metadata:{mode:"fullscreen"}})]},
  {id:"track-overlays",name:"Analyse & Overlays",type:"overlay",zIndex:60,locked:false,hidden:false,color:"#E6C056",items:[item({id:"company-title",type:"text",label:"Firmenname",trackId:"track-overlays",startMs:1500,endMs:7000,zIndex:60,text:"Kurze Analyse für {{company}}",fontSize:52,fontWeight:800,color:"#FFFFFF",backgroundColor:"rgba(17,17,17,.78)",transform:studioV3Transform({x:5,y:72,width:52,height:16,borderRadius:14})}),item({id:"metric-opportunity",type:"metric",label:"Opportunity",trackId:"track-overlays",startMs:21000,endMs:30000,zIndex:62,text:"Opportunity",subtext:"{{opportunity}} / 100",fontSize:38,fontWeight:800,color:"#111111",backgroundColor:"#FFFFFF",transform:studioV3Transform({x:6,y:67,width:28,height:20,borderRadius:16}),animationIn:"pop"}),item({id:"metric-pv",type:"metric",label:"PV Potenzial",trackId:"track-overlays",startMs:29000,endMs:39000,zIndex:62,text:"PV-Vorprüfung",subtext:"{{pv_kwp}} kWp",fontSize:38,fontWeight:800,color:"#111111",backgroundColor:"#FFFFFF",transform:studioV3Transform({x:6,y:67,width:28,height:20,borderRadius:16}),animationIn:"slide-up"}),item({id:"cta-overlay",type:"text",label:"CTA",trackId:"track-overlays",startMs:73500,endMs:85000,zIndex:65,text:"{{cta}}",fontSize:48,fontWeight:850,textAlign:"center",color:"#FFFFFF",backgroundColor:"#111111",transform:studioV3Transform({x:22,y:71,width:56,height:15,borderRadius:18}),animationIn:"pop"})]},
  {id:"track-brand",name:"Branding",type:"text",zIndex:80,locked:false,hidden:false,color:"#111111",items:[item({id:"brand-logo",type:"logo",label:"Walkenhorst Logo",trackId:"track-brand",startMs:0,endMs:85000,zIndex:80,dynamicSource:"logo",transform:studioV3Transform({x:3,y:3,width:18,height:9}),fit:"contain",animationIn:"none",animationOut:"none"})]},
  {id:"track-audio",name:"Audio",type:"audio",zIndex:5,locked:false,hidden:false,muted:false,color:"#7A65D1",items:[]}
 ]};
}

export function defaultStudioV3Landing():StudioV3LandingConfig{return{version:3,theme:"walkenhorst",showLogo:true,stickyCta:true,blocks:[
 {id:"lp-hero",type:"hero",enabled:true,order:10,eyebrow:"Persönliche Energieanalyse",headline:"{{firstname}}, wir haben uns {{company}} kurz angesehen.",body:"Drei konkrete Punkte, die für Ihre Energiekosten, Eigenversorgung und Effizienz interessant sein können.",style:{background:"brand.background",textColor:"brand.text",accentColor:"brand.accent",paddingY:54,maxWidth:1180,radius:0,align:"left"}},
 {id:"lp-video",type:"video",enabled:true,order:20,headline:"Ihre persönliche Videoanalyse",style:{background:"brand.background",paddingY:18,maxWidth:1180,radius:18,align:"center"}},
 {id:"lp-findings",type:"findings",enabled:true,order:30,eyebrow:"Was wir gesehen haben",headline:"Drei relevante Ansatzpunkte",style:{background:"brand.surface",textColor:"brand.text",accentColor:"brand.accent",paddingY:52,maxWidth:1180,radius:20,align:"left"}},
 {id:"lp-metrics",type:"metrics",enabled:true,order:40,headline:"Erste Potenzialindikatoren",style:{background:"brand.background",paddingY:38,maxWidth:1180,radius:18,align:"left"}},
 {id:"lp-trust",type:"trust",enabled:true,order:50,eyebrow:"Walkenhorst Energie",headline:"Ihre Energiezukunft ist meine Expertise.",body:"Persönliche, transparente Beratung mit einem starken Netzwerk und Fokus auf messbaren wirtschaftlichen Nutzen.",style:{background:"brand.primary",textColor:"#FFFFFF",accentColor:"brand.accent",paddingY:56,maxWidth:1180,radius:22,align:"left"}},
 {id:"lp-about",type:"about",enabled:true,order:60,headline:"Andreas Walkenhorst – Ihr persönlicher Energiepartner",body:"Seit über 30 Jahren Beratung in anspruchsvollen Produktbereichen, davon 10 Jahre spezialisiert auf die dynamische Energiebranche.",style:{background:"brand.background",paddingY:46,maxWidth:1180,radius:18,align:"left"}},
 {id:"lp-qualification",type:"qualification",enabled:true,order:70,eyebrow:"60-Sekunden-Potenzialcheck",headline:"Was ist für {{company}} gerade am interessantesten?",style:{background:"brand.surface",paddingY:50,maxWidth:920,radius:20,align:"left"}},
 {id:"lp-cta",type:"cta",enabled:true,order:80,headline:"Lassen Sie uns die Zahlen konkret prüfen.",body:"Ein kurzer Austausch reicht, um Verbrauch, Fläche und vorhandene Verträge richtig einzuordnen.",ctaLabel:"{{cta}}",style:{background:"brand.accent",textColor:"#111111",paddingY:48,maxWidth:1180,radius:22,align:"center"}},
 {id:"lp-footer",type:"footer",enabled:true,order:90,style:{background:"brand.primary",textColor:"#FFFFFF",paddingY:30,maxWidth:1180,radius:0,align:"left"}}
]}}
export function defaultStudioV3Project(presetKey="pv-gewerbe"):StudioV3Project{const preset=STUDIO_V3_PRESETS.find(p=>p.key===presetKey)??STUDIO_V3_PRESETS[0];const timeline=defaultStudioV3Timeline();const landing=defaultStudioV3Landing();landing.blocks=landing.blocks.map(block=>block.type==="hero"?{...block,headline:`{{firstname}}, kurze Analyse für {{company}}.`,body:`${preset.problem}. Wir zeigen Ihnen in wenigen Minuten, welche Punkte sich als Nächstes konkret prüfen lassen.`}:block);return{version:3,name:`Walkenhorst · ${preset.label}`,presetKey,timeline,landing}}

export function normalizeStudioV3Project(input:unknown,presetKey="pv-gewerbe"):StudioV3Project{const fallback=defaultStudioV3Project(presetKey);if(!input||typeof input!=="object")return fallback;const raw=input as Partial<StudioV3Project>;if(raw.version!==3||!raw.timeline||!Array.isArray(raw.timeline.tracks))return fallback;const ratio=(raw.timeline.aspectRatio||"16:9") as StudioV3AspectRatio;const resolution=studioV3Resolution(ratio);const durationMs=clampStudio(Number(raw.timeline.durationMs||fallback.timeline.durationMs),1000,15*60*1000);const tracks=raw.timeline.tracks.map((track,index)=>({...track,zIndex:Number(track.zIndex??index*10),locked:Boolean(track.locked),hidden:Boolean(track.hidden),items:Array.isArray(track.items)?track.items.map(rawItem=>({...rawItem,startMs:clampStudio(Number(rawItem.startMs||0),0,durationMs-1),endMs:clampStudio(Number(rawItem.endMs||durationMs),1,durationMs),zIndex:Number(rawItem.zIndex||track.zIndex||0),transform:studioV3Transform(rawItem.transform||{})})).filter(x=>x.endMs>x.startMs):[]}));return{...fallback,...raw,version:3,presetKey:raw.presetKey||presetKey,timeline:{...fallback.timeline,...raw.timeline,version:3,durationMs,width:Number(raw.timeline.width||resolution.width),height:Number(raw.timeline.height||resolution.height),tracks},landing:raw.landing?.version===3?raw.landing:fallback.landing}}

export function studioV3Variables(input:StudioV3LeadVariables){return{company:String(input.company||"Musterunternehmen"),firstname:String(input.firstname||"").trim().split(/\s+/)[0]||"Sie",website:String(input.website||"Unternehmenswebsite"),city:String(input.city||"Ihrer Region"),industry:String(input.industry||"Unternehmen"),problem:String(input.problem||"Energie- und PV-Potenzial"),opportunity:String(input.opportunity??"–"),roof_area:String(input.roof_area??"–"),pv_kwp:String(input.pv_kwp??"–"),pv_yield:String(input.pv_yield??"–"),energy_score:String(input.energy_score??"–"),saving_estimate:String(input.saving_estimate??"–"),cta:String(input.cta||"Kostenlosen Potenzialcheck vereinbaren")}}
export function resolveStudioV3Text(template:string,input:StudioV3LeadVariables){const values=studioV3Variables(input);return Object.entries(values).reduce((text,[key,value])=>text.replaceAll(`{{${key}}}`,value),String(template||""))}
export function studioV3AllItems(timeline:StudioV3Timeline){return timeline.tracks.flatMap(track=>track.hidden?[]:track.items.filter(item=>!item.hidden).map(item=>({...item,trackZ:track.zIndex}))).sort((a,b)=>(a.trackZ+a.zIndex)-(b.trackZ+b.zIndex))}
export function studioV3ActiveItems(timeline:StudioV3Timeline,timeMs:number){return studioV3AllItems(timeline).filter(item=>timeMs>=item.startMs&&timeMs<item.endMs)}
export function studioV3Time(valueMs:number){const total=Math.max(0,Math.round(valueMs));const min=Math.floor(total/60000);const sec=Math.floor((total%60000)/1000);const ms=Math.floor((total%1000)/10);return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${String(ms).padStart(2,"0")}`}
export function studioV3ParseTime(value:string){const match=String(value).trim().match(/^(?:(\d+):)?(\d{1,2})(?:[.,:](\d{1,3}))?$/);if(!match)return NaN;const min=Number(match[1]||0),sec=Number(match[2]||0),fraction=String(match[3]||"0").padEnd(3,"0").slice(0,3);return min*60000+sec*1000+Number(fraction)}
export function studioV3SnapshotBrand(brand:StudioV3BrandKit){return JSON.parse(JSON.stringify(brand)) as StudioV3BrandKit}
