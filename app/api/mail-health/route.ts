import { NextResponse } from "next/server";
import { resolveTxt } from "node:dns/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TxtCheck = { found: boolean; records: string[] };

function normalizeDomain(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  const domain = raw.includes("@") ? raw.split("@").pop()! : raw;
  if (!domain || domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error("Ungültige E-Mail-Domain");
  }
  return domain;
}

async function txt(host: string): Promise<string[]> {
  try {
    const rows = await resolveTxt(host);
    return rows.map(parts => parts.join("")).filter(Boolean).slice(0, 30);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT"].includes(String(code))) return [];
    throw error;
  }
}

async function checkSpf(domain: string): Promise<TxtCheck> {
  const records = (await txt(domain)).filter(v => /^v=spf1\b/i.test(v));
  return { found: records.length > 0, records };
}

async function checkDmarc(domain: string): Promise<TxtCheck> {
  const records = (await txt(`_dmarc.${domain}`)).filter(v => /^v=dmarc1\b/i.test(v));
  return { found: records.length > 0, records };
}

async function checkDkim(domain: string, selector?: string) {
  const selectors = selector
    ? [selector]
    : ["google", "default", "selector1", "selector2", "s1", "s2", "k1"];
  const hits: Array<{ selector: string; records: string[] }> = [];
  for (const candidate of selectors) {
    const clean = candidate.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 63);
    if (!clean) continue;
    const records = await txt(`${clean}._domainkey.${domain}`);
    if (records.some(v => /\bv=dkim1\b/i.test(v) || /\bp=/i.test(v))) hits.push({ selector: clean, records });
  }
  return { found: hits.length > 0, selectorsChecked: selectors, hits };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const domain = normalizeDomain(body?.domain ?? body?.email);
    const selector = body?.selector ? String(body.selector).trim() : undefined;
    const [spf, dmarc, dkim] = await Promise.all([checkSpf(domain), checkDmarc(domain), checkDkim(domain, selector)]);

    const score = (spf.found ? 35 : 0) + (dmarc.found ? 35 : 0) + (dkim.found ? 30 : 0);
    const recommendations: string[] = [];
    if (!spf.found) recommendations.push("SPF-TXT-Record für die Absenderdomain einrichten.");
    if (!dmarc.found) recommendations.push("DMARC unter _dmarc der Domain einrichten; zum Start kann eine Monitoring-Policy sinnvoll sein.");
    if (!dkim.found) recommendations.push(selector ? `Kein DKIM-Key für Selector „${selector}“ gefunden.` : "DKIM konnte mit gängigen Selectors nicht automatisch erkannt werden. Provider-Selector prüfen und gezielt testen.");
    if (score === 100) recommendations.push("SPF, DMARC und DKIM sind per DNS erkennbar. Versandverhalten, Reputation und Listenqualität bleiben trotzdem entscheidend.");

    return NextResponse.json({ domain, score, spf, dmarc, dkim, recommendations, checkedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Domain-Check fehlgeschlagen" }, { status: 400 });
  }
}
