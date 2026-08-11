import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENT = "Walkenhorst-Energy-Radar/1.0 (+https://www.walkenhorst-pv.de/)";
const NOMINATIM = process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
const OVERPASS = process.env.OVERPASS_BASE_URL || "https://overpass-api.de/api/interpreter";

type RawLead = {
  source: "osm";
  externalId: string;
  sourceUrl: string;
  companyName: string;
  website: string | null;
  city: string | null;
  postcode: string | null;
  address: string | null;
  industry: string | null;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  lat: number | null;
  lon: number | null;
  metadata: Record<string, unknown>;
};

const CATEGORY_QUERIES: Record<string, { label: string; filters: string[] }> = {
  logistics: { label: "Logistik", filters: ['["office"="logistics"]', '["industrial"="logistics"]', '["building"="warehouse"]["name"]'] },
  production: { label: "Produktion / Industrie", filters: ['["man_made"="works"]["name"]', '["industrial"]["name"]', '["craft"]["name"]'] },
  hotel: { label: "Hotel", filters: ['["tourism"="hotel"]', '["tourism"="motel"]'] },
  automotive: { label: "Autohaus / Kfz", filters: ['["shop"="car"]', '["shop"="car_repair"]'] },
  care: { label: "Pflege / Gesundheit", filters: ['["amenity"="nursing_home"]', '["healthcare"="nursing_home"]', '["social_facility"="nursing_home"]'] },
  retail: { label: "Handel", filters: ['["shop"="supermarket"]', '["shop"="department_store"]', '["shop"="furniture"]', '["shop"="doityourself"]'] },
  company: { label: "Unternehmen", filters: ['["office"="company"]', '["office"="business"]'] },
};

function private4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function private6(ip: string) {
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v);
}
async function assertPublicUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Interne URL blockiert");
  const literal = net.isIP(host);
  if (literal === 4 && private4(host)) throw new Error("Private IP blockiert");
  if (literal === 6 && private6(host)) throw new Error("Private IP blockiert");
  if (!literal) {
    const records = await lookup(host, { all: true, verbatim: true }).catch(() => []);
    if (!records.length) throw new Error("Domain nicht auflösbar");
    for (const record of records) {
      if (record.family === 4 && private4(record.address)) throw new Error("Private Zieladresse blockiert");
      if (record.family === 6 && private6(record.address)) throw new Error("Private Zieladresse blockiert");
    }
  }
}
function websiteUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch { return null; }
}
function firstTag(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) if (tags[key]?.trim()) return tags[key].trim();
  return null;
}
function cleanPhone(value: string | null) { return value ? value.replace(/\s+/g, " ").trim().slice(0, 80) : null; }
function cleanEmail(value: string | null) {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function industryFrom(tags: Record<string, string>, fallback: string) {
  return tags.industrial || tags.craft || tags.office || tags.shop || tags.tourism || tags.amenity || tags.healthcare || tags.social_facility || fallback;
}
function normalizeElement(element: any, categoryLabel: string): RawLead | null {
  const tags = (element.tags || {}) as Record<string, string>;
  const name = tags.name?.trim();
  if (!name) return null;
  const type = String(element.type || "node");
  const id = String(element.id || "");
  const street = firstTag(tags, ["addr:street"]);
  const house = firstTag(tags, ["addr:housenumber"]);
  const city = firstTag(tags, ["addr:city", "addr:place", "addr:town", "addr:village"]);
  const postcode = firstTag(tags, ["addr:postcode"]);
  const address = [street, house].filter(Boolean).join(" ") || null;
  const center = element.center || element;
  return {
    source: "osm",
    externalId: `${type}/${id}`,
    sourceUrl: `https://www.openstreetmap.org/${type}/${id}`,
    companyName: name.slice(0, 240),
    website: websiteUrl(firstTag(tags, ["contact:website", "website", "url"]) || undefined),
    city,
    postcode,
    address,
    industry: industryFrom(tags, categoryLabel),
    phone: cleanPhone(firstTag(tags, ["contact:phone", "phone", "contact:mobile"])),
    email: cleanEmail(firstTag(tags, ["contact:email", "email"])),
    linkedinUrl: websiteUrl(firstTag(tags, ["contact:linkedin", "linkedin"]) || undefined),
    lat: Number.isFinite(Number(center.lat)) ? Number(center.lat) : null,
    lon: Number.isFinite(Number(center.lon)) ? Number(center.lon) : null,
    metadata: { osm_tags: tags },
  };
}

async function geocode(location: string) {
  const url = new URL("/search", NOMINATIM);
  url.searchParams.set("q", location);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, next: { revalidate: 86_400 } });
  if (!response.ok) throw new Error(`Ortsauflösung fehlgeschlagen (${response.status})`);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error("Ort wurde nicht gefunden.");
  return { lat: Number(row.lat), lon: Number(row.lon), displayName: String(row.display_name || location) };
}

async function queryOverpass(lat: number, lon: number, radius: number, filters: string[], limit: number) {
  const blocks = filters.flatMap((filter) => [
    `node${filter}(around:${radius},${lat},${lon});`,
    `way${filter}(around:${radius},${lat},${lon});`,
    `relation${filter}(around:${radius},${lat},${lon});`,
  ]).join("\n");
  const q = `[out:json][timeout:25];(\n${blocks}\n);out center tags ${Math.min(250, limit * 3)};`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(OVERPASS, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": USER_AGENT, accept: "application/json" }, body: new URLSearchParams({ data: q }), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Lead-Datenquelle antwortet mit ${response.status}. Bitte später erneut versuchen.`);
    const data = await response.json();
    return Array.isArray(data?.elements) ? data.elements : [];
  } finally { clearTimeout(timer); }
}

async function enrichWebsite(lead: RawLead) {
  if (!lead.website) return lead;
  try {
    let current = new URL(lead.website);
    let response: Response | null = null;
    for (let i = 0; i < 3; i++) {
      await assertPublicUrl(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try { response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: "text/html" } }); }
      finally { clearTimeout(timer); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); if (!location) break; current = new URL(location, current); continue;
      }
      break;
    }
    if (!response?.ok || !(response.headers.get("content-type") || "").includes("text/html")) return lead;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 1_500_000) return lead;
    const html = (await response.text()).slice(0, 1_500_000);
    const emails = [...html.matchAll(/mailto:([^"'?#\s>]+)/gi)].map((m) => cleanEmail(decodeURIComponent(m[1]))).filter(Boolean) as string[];
    const phones = [...html.matchAll(/tel:([^"'?\s>]+)/gi)].map((m) => cleanPhone(decodeURIComponent(m[1]))).filter(Boolean) as string[];
    const linkedIn = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^"']+)/i)?.[1] || null;
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim().slice(0, 180);
    return { ...lead, website: current.toString(), email: lead.email || emails[0] || null, phone: lead.phone || phones[0] || null, linkedinUrl: lead.linkedinUrl || linkedIn, metadata: { ...lead.metadata, website_title: title, enriched: true } };
  } catch { return lead; }
}

async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (true) { const index = cursor++; if (index >= items.length) return; results[index] = await fn(items[index]); } }));
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const category = String(body?.category || "production");
    const config = CATEGORY_QUERIES[category];
    if (!config) return NextResponse.json({ error: "Unbekannte Zielgruppe." }, { status: 400 });
    const location = String(body?.location || "").trim();
    if (location.length < 2 || location.length > 120) return NextResponse.json({ error: "Bitte einen gültigen Ort eingeben." }, { status: 400 });
    const radiusKm = Math.max(1, Math.min(50, Number(body?.radiusKm) || 15));
    const limit = Math.max(5, Math.min(100, Number(body?.limit) || 50));
    const enrich = body?.enrich !== false;
    const place = await geocode(location);
    const elements = await queryOverpass(place.lat, place.lon, Math.round(radiusKm * 1000), config.filters, limit);
    const dedupe = new Map<string, RawLead>();
    for (const element of elements) {
      const lead = normalizeElement(element, config.label); if (!lead) continue;
      const key = lead.website ? new URL(lead.website).hostname.replace(/^www\./, "").toLowerCase() : `${lead.companyName.toLowerCase()}|${lead.city || ""}`;
      if (!dedupe.has(key)) dedupe.set(key, lead);
      if (dedupe.size >= limit) break;
    }
    let leads = [...dedupe.values()];
    if (enrich) leads = await mapLimit(leads.slice(0, 30), 4, enrichWebsite).then((enriched) => [...enriched, ...leads.slice(30)]);
    return NextResponse.json({ leads, location: place, category: config.label, attribution: "© OpenStreetMap contributors", count: leads.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lead-Suche fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
