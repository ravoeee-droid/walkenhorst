export type EnergyStudioRole = "website" | "speaker" | "proof";
export type EnergyStudioSegmentType = "website" | "video" | "image";

export type EnergyStudioSegment = {
  id: string;
  type: EnergyStudioSegmentType;
  role: EnergyStudioRole;
  label: string;
  assetId?: string;
  mediaUrl?: string;
  duration?: number;
  caption?: string;
};

export type EnergyStudioConfig = {
  version: 2;
  presetKey: string;
  name: string;
  headline: string;
  subtitle: string;
  ctaLabel: string;
  ctaUrl: string;
  accentColor: string;
  presenterName: string;
  presenterAssetId?: string;
  websiteCaptureAssetId?: string;
  segments: EnergyStudioSegment[];
};

export type StudioLeadVariables = {
  company?: string | null;
  firstname?: string | null;
  website?: string | null;
  city?: string | null;
  problem?: string | null;
  opportunity?: string | number | null;
  cta?: string | null;
};

export const STUDIO_BUCKET = "energy-media";
export const PRESENTER_ASSET_SENTINEL = "__presenter__";

export const ENERGY_STUDIO_PRESETS = [
  {
    key: "pv-gewerbe",
    label: "PV Gewerbe",
    description: "Eigenverbrauch, Dachfläche und Stromkosten für Gewerbebetriebe.",
    headline: "3 konkrete Energie-Hebel für {{company}}",
    subtitle: "Wir haben {{company}} kurz analysiert und sehen mehrere Ansatzpunkte, mit denen sich Eigenverbrauch, Stromkosten und die Nutzung vorhandener Flächen gezielt prüfen lassen.",
  },
  {
    key: "energieberatung",
    label: "Energieberatung",
    description: "Effizienz, Verbrauch und nächste sinnvolle Prüfschritte.",
    headline: "Kurze Energie-Analyse für {{company}}",
    subtitle: "Auf Basis der öffentlich sichtbaren Unternehmensdaten haben wir erste Effizienz- und Energiepotenziale für {{company}} zusammengetragen.",
  },
  {
    key: "dachflaeche",
    label: "Große Dachfläche",
    description: "Fokus auf nutzbare Gewerbeflächen und PV-Eigenverbrauch.",
    headline: "Was die Dachfläche von {{company}} energetisch leisten könnte",
    subtitle: "Die Kombination aus Gebäudenutzung, möglicher Dachfläche und betrieblichem Stromverbrauch macht einen konkreten PV-Potenzialcheck interessant.",
  },
  {
    key: "energiekosten",
    label: "Hohe Energiekosten",
    description: "Kostenhebel, Lastprofil und Eigenversorgung.",
    headline: "Wo {{company}} Energiekosten systematisch prüfen kann",
    subtitle: "Wir haben drei Punkte vorbereitet, die sich für eine wirtschaftliche Prüfung von Stromkosten, Eigenversorgung und Effizienz besonders anbieten.",
  },
  {
    key: "foerderung",
    label: "Förderung & Effizienz",
    description: "Investitionen, Effizienzmaßnahmen und Förderfähigkeit.",
    headline: "Energie-Investitionen bei {{company}} intelligenter priorisieren",
    subtitle: "Wir zeigen kurz, welche energetischen Maßnahmen sich zuerst prüfen lassen und an welchen Stellen Förder- oder Finanzierungsmöglichkeiten relevant werden können.",
  },
] as const;

export function makeDefaultStudioConfig(presetKey = "pv-gewerbe"): EnergyStudioConfig {
  const preset = ENERGY_STUDIO_PRESETS.find((item) => item.key === presetKey) ?? ENERGY_STUDIO_PRESETS[0];
  return {
    version: 2,
    presetKey: preset.key,
    name: preset.label,
    headline: preset.headline,
    subtitle: preset.subtitle,
    ctaLabel: "Kostenlosen Potenzialcheck vereinbaren",
    ctaUrl: "https://www.walkenhorst-eko.de/",
    accentColor: "#17945c",
    presenterName: "Walkenhorst Energie",
    segments: [
      { id: "website-intro", type: "website", role: "website", label: "Website-Intro", duration: 8 },
      { id: "presenter-core", type: "video", role: "speaker", label: "Persönliche Einordnung", assetId: PRESENTER_ASSET_SENTINEL },
      { id: "website-detail", type: "website", role: "website", label: "Potenzial im Detail", duration: 10 },
    ],
  };
}

export function parseStudioConfig(value: unknown, presetKey = "pv-gewerbe"): EnergyStudioConfig {
  const fallback = makeDefaultStudioConfig(presetKey);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<EnergyStudioConfig>;
  const segments = Array.isArray(raw.segments)
    ? raw.segments.filter((segment): segment is EnergyStudioSegment => Boolean(
        segment && typeof segment === "object" &&
        ["website", "video", "image"].includes(String((segment as EnergyStudioSegment).type)) &&
        ["website", "speaker", "proof"].includes(String((segment as EnergyStudioSegment).role)),
      )).map((segment) => ({
        ...segment,
        duration: segment.duration == null ? undefined : Math.max(1, Math.min(120, Number(segment.duration) || 4)),
      }))
    : fallback.segments;
  const normalizedSegments = segments.some((segment) => segment.assetId === PRESENTER_ASSET_SENTINEL)
    ? segments
    : [...segments, { id: "presenter-core", type: "video", role: "speaker", label: "Persönliche Einordnung", assetId: PRESENTER_ASSET_SENTINEL } as EnergyStudioSegment];
  return {
    ...fallback,
    ...raw,
    version: 2,
    presetKey: typeof raw.presetKey === "string" ? raw.presetKey : fallback.presetKey,
    headline: typeof raw.headline === "string" ? raw.headline : fallback.headline,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : fallback.subtitle,
    ctaLabel: typeof raw.ctaLabel === "string" ? raw.ctaLabel : fallback.ctaLabel,
    ctaUrl: typeof raw.ctaUrl === "string" ? raw.ctaUrl : fallback.ctaUrl,
    accentColor: /^#[0-9a-f]{6}$/i.test(String(raw.accentColor || "")) ? String(raw.accentColor) : fallback.accentColor,
    presenterName: typeof raw.presenterName === "string" ? raw.presenterName : fallback.presenterName,
    segments: normalizedSegments,
  };
}

export function studioVariables(input: StudioLeadVariables) {
  return {
    company: String(input.company || "Musterunternehmen"),
    firstname: String(input.firstname || "").trim().split(/\s+/)[0] || "Sie",
    website: String(input.website || "Unternehmenswebsite"),
    city: String(input.city || "Ihrer Region"),
    problem: String(input.problem || "Energie- und PV-Potenzial"),
    opportunity: String(input.opportunity ?? "–"),
    cta: String(input.cta || "Potenzialcheck"),
  };
}

export function resolveStudioText(template: string, input: StudioLeadVariables) {
  const values = studioVariables(input);
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), String(template || ""));
}

export function slugifyStudioCompany(value: string) {
  return String(value || "analyse")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46) || "analyse";
}

export function studioDuration(segments: EnergyStudioSegment[]) {
  return Math.max(1, Math.round(segments.reduce((sum, segment) => {
    if (segment.type === "video") return sum + Math.max(1, Number(segment.duration || 15));
    return sum + Math.max(1, Number(segment.duration || 4));
  }, 0)));
}
