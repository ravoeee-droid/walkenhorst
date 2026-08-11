export type EnergyLeadInput = {
  company_name: string;
  website?: string | null;
  city?: string | null;
  industry?: string | null;
  employees?: number | null;
  location_count?: number | null;
  roof_area_m2?: number | null;
  annual_energy_kwh?: number | null;
  pv_present?: boolean | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type EnergyScores = {
  pvScore: number;
  energyScore: number;
  intentScore: number;
  contactabilityScore: number;
  totalScore: number;
  summary: string;
  pitch: string;
  nextAction: string;
};

const ENERGY_INTENSIVE = /produktion|industrie|logistik|lager|hotel|gastronomie|pflege|autohaus|werkstatt|landwirtschaft|lebensmittel|kühl|metall|kunststoff|druck|rechenzentrum|fitness/i;
const ROOF_FRIENDLY = /logistik|lager|produktion|industrie|autohaus|werkstatt|landwirtschaft|handel|supermarkt|möbel|baustoff/i;

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const numberOrZero = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : 0;

export function scoreEnergyLead(input: EnergyLeadInput): EnergyScores {
  const employees = numberOrZero(input.employees);
  const locations = Math.max(1, numberOrZero(input.location_count) || 1);
  const roof = numberOrZero(input.roof_area_m2);
  const consumption = numberOrZero(input.annual_energy_kwh);
  const industry = input.industry ?? "";

  let pv = 24;
  if (roof >= 300) pv += 16;
  if (roof >= 800) pv += 13;
  if (roof >= 1500) pv += 10;
  if (ROOF_FRIENDLY.test(industry)) pv += 12;
  if (employees >= 20) pv += 8;
  if (employees >= 75) pv += 7;
  if (locations >= 2) pv += Math.min(12, locations * 3);
  if (input.pv_present === false) pv += 12;
  if (input.pv_present === true) pv -= 18;
  const pvScore = clamp(pv);

  let energy = 20;
  if (ENERGY_INTENSIVE.test(industry)) energy += 22;
  if (employees >= 20) energy += 10;
  if (employees >= 75) energy += 10;
  if (locations >= 2) energy += Math.min(12, locations * 3);
  if (consumption >= 100_000) energy += 12;
  if (consumption >= 500_000) energy += 14;
  if (consumption >= 1_000_000) energy += 8;
  const energyScore = clamp(energy);

  let intent = 36;
  if (input.website) intent += 8;
  if (input.pv_present === false) intent += 10;
  if (roof >= 800) intent += 12;
  if (ENERGY_INTENSIVE.test(industry)) intent += 12;
  if (locations >= 2) intent += 8;
  const intentScore = clamp(intent);

  let contactability = 10;
  if (input.phone) contactability += 34;
  if (input.email) contactability += 30;
  if (input.contact_name) contactability += 18;
  if (input.website) contactability += 8;
  const contactabilityScore = clamp(contactability);

  const totalScore = clamp(pvScore * 0.38 + energyScore * 0.29 + intentScore * 0.18 + contactabilityScore * 0.15);
  const strongest = pvScore >= energyScore ? "PV-Potenzial" : "Energieeffizienz-Potenzial";
  const company = input.company_name || "das Unternehmen";
  const signals = [
    roof >= 800 ? `große Dachfläche (${Math.round(roof)} m²)` : null,
    locations >= 2 ? `${locations} Standorte` : null,
    ENERGY_INTENSIVE.test(industry) ? "energieintensive Branche" : null,
    input.pv_present === false ? "keine erkennbare PV-Anlage" : null,
    employees >= 75 ? `${employees} Mitarbeitende` : null,
  ].filter(Boolean) as string[];

  const summary = signals.length
    ? `${company} zeigt ${signals.slice(0, 3).join(", ")}. Der stärkste Hebel ist aktuell das ${strongest}.`
    : `${company} passt grundsätzlich in das gewerbliche Energieprofil. Für einen belastbaren Business Case sollten Dachfläche und Verbrauch ergänzt werden.`;

  const pitch = `Guten Tag${input.contact_name ? ` ${input.contact_name}` : ""}, ich habe mir ${company}${input.city ? ` in ${input.city}` : ""} kurz angesehen. Dabei ist mir aufgefallen, dass hier insbesondere beim ${strongest} ein interessanter Hebel bestehen könnte. Ich würde Ihnen gern in zwei Minuten zeigen, welche Punkte wir konkret gefunden haben – passt es gerade kurz?`;
  const nextAction = totalScore >= 80
    ? "Heute priorisiert anrufen und personalisierte Video-Analyse senden."
    : totalScore >= 65
      ? "Research vervollständigen, Video-Seite erstellen und innerhalb von 24 Stunden kontaktieren."
      : "Daten anreichern und vor aktivem Outreach erneut bewerten.";

  return { pvScore, energyScore, intentScore, contactabilityScore, totalScore, summary, pitch, nextAction };
}

export function slugifyCompany(company: string) {
  const base = company.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " und ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54);
  return `${base || "analyse"}-${crypto.randomUUID().slice(0, 6)}`;
}
