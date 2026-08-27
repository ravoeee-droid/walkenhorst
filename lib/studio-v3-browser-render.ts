"use client";

import type { StudioV3BrandKit, StudioV3Item, StudioV3LeadVariables, StudioV3Timeline } from "@/lib/studio-v3";

type Options = {
  timeline: StudioV3Timeline;
  brand: StudioV3BrandKit;
  variables: StudioV3LeadVariables;
  resolveSource: (item: StudioV3Item) => string | null;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
  maxWidth?: number;
};

type RenderResult = {
  blob: Blob;
  format: "mp4";
  mimeType: "video/mp4";
  warnings: string[];
  width: number;
  height: number;
};

const ENERGY_SPRITE = "/assets/energiekosten/production-sprite.webp";
const ENERGY_TIMINGS: Record<number, [number, number]> = {
  1: [14200, 25200],
  2: [25200, 36200],
  3: [36200, 46200],
  4: [46200, 58200],
  5: [58200, 69200],
  6: [69200, 82200],
  7: [82200, 93200],
  8: [93200, 107000],
};

function slideNumber(item: StudioV3Item) {
  if (item.type !== "image") return null;
  const match = String(item.label || "").match(/Energiekosten\s*·\s*(?:Clean|Original|Production)\s*·\s*(0[1-8])/i);
  return match ? Number(match[1]) : null;
}

function normalizeTimeline(input: StudioV3Timeline) {
  const timeline = JSON.parse(JSON.stringify(input)) as StudioV3Timeline;
  const found = new Set<number>();
  for (const track of timeline.tracks) for (const item of track.items) {
    const slide = slideNumber(item);
    if (slide) found.add(slide);
  }
  if (!found.size) return { timeline, energy: false };
  if (found.size !== 8) throw new Error(`Energiekosten-Master unvollständig: ${found.size}/8 Slides gefunden.`);
  timeline.durationMs = 107000;
  for (const track of timeline.tracks) for (const item of track.items) {
    if (item.type === "presenter" || item.dynamicSource === "presenter") {
      item.startMs = 0;
      item.endMs = 107000;
      continue;
    }
    if (item.type === "website" || item.dynamicSource === "website_capture") {
      item.startMs = 0;
      item.endMs = 14200;
      continue;
    }
    const slide = slideNumber(item);
    if (slide && ENERGY_TIMINGS[slide]) {
      item.startMs = ENERGY_TIMINGS[slide][0];
      item.endMs = ENERGY_TIMINGS[slide][1];
    }
  }
  return { timeline, energy: true };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string, onTimeout?: () => void) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => { if (!settled) { settled = true; window.clearTimeout(timer); resolve(value); } },
      (error) => { if (!settled) { settled = true; window.clearTimeout(timer); reject(error); } },
    );
  });
}

function loadImage(url: string, ms = 15000) {
  return withTimeout(new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Bild nicht erreichbar: ${url}`));
    image.src = url;
  }), ms, `Bild-Asset Timeout nach ${Math.round(ms / 1000)} Sekunden.`);
}

function loadMedia(url: string, ms = 30000) {
  return withTimeout(new Promise<void>((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.playsInline = true;
    const clean = () => { video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); try { video.load(); } catch {} };
    video.onloadedmetadata = () => { clean(); resolve(); };
    video.onerror = () => { clean(); reject(new Error(`Video nicht erreichbar: ${url}`)); };
    video.src = url;
    video.load();
  }), ms, `Video-Asset Timeout nach ${Math.round(ms / 1000)} Sekunden.`);
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Slide konnte nicht vorbereitet werden.")),
    "image/webp",
    .92,
  ));
}

async function buildEnergySlides() {
  const sprite = await loadImage(ENERGY_SPRITE, 15000);
  if (sprite.naturalWidth !== 2560 || sprite.naturalHeight !== 2880) {
    throw new Error(`Energiekosten-Produktionsgrafik ungültig: ${sprite.naturalWidth}×${sprite.naturalHeight}.`);
  }
  const urls = new Map<number, string>();
  for (let slide = 1; slide <= 8; slide++) {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error(`Slide ${slide}: Canvas konnte nicht erstellt werden.`);
    const index = slide - 1;
    ctx.drawImage(sprite, (index % 2) * 1280, Math.floor(index / 2) * 720, 1280, 720, 0, 0, 1280, 720);
    const blob = await canvasBlob(canvas);
    urls.set(slide, URL.createObjectURL(blob));
  }
  return urls;
}

async function preflight(timeline: StudioV3Timeline, resolveSource: (item: StudioV3Item) => string | null) {
  const unique = new Map<string, StudioV3Item>();
  for (const item of timeline.tracks.flatMap((track) => track.items).filter((item) => !item.hidden)) {
    const url = resolveSource(item) || item.sourceUrl;
    const critical = ["image", "website", "video", "presenter"].includes(item.type);
    if (!url) {
      if (critical) throw new Error(`${item.label || item.type}: erforderliches Asset fehlt.`);
      continue;
    }
    if (!unique.has(url)) unique.set(url, item);
  }
  await Promise.all(Array.from(unique.entries()).map(async ([url, item]) => {
    try {
      if (["video", "presenter"].includes(item.type)) await loadMedia(url);
      else if (["image", "website", "logo", "map"].includes(item.type)) await loadImage(url);
    } catch (error) {
      throw new Error(`${item.label || item.type}: ${error instanceof Error ? error.message : "Asset konnte nicht geladen werden."}`);
    }
  }));
}

export async function renderStudioV3Browser(options: Options): Promise<RenderResult> {
  if (typeof window === "undefined") throw new Error("Video-Rendering ist nur im Browser verfügbar.");
  const { timeline, energy } = normalizeTimeline(options.timeline);
  const slideUrls = energy ? await buildEnergySlides() : new Map<number, string>();
  const resolveSource = (item: StudioV3Item) => {
    const slide = energy ? slideNumber(item) : null;
    if (slide && slideUrls.has(slide)) return slideUrls.get(slide) || null;
    return options.resolveSource(item);
  };
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    options.onProgress?.(0);
    await preflight(timeline, resolveSource);
    if (controller.signal.aborted || options.signal?.aborted) throw new DOMException("Render abgebrochen", "AbortError");
    const deadline = Math.max(180000, timeline.durationMs * 2.5);
    const { renderStudioV3Browser: renderCore } = await import("@/lib/studio-v3-browser-render-core");
    return await withTimeout(
      renderCore({ ...options, timeline, resolveSource, signal: controller.signal }),
      deadline,
      `Video-Render Timeout nach ${Math.round(deadline / 1000)} Sekunden.`,
      () => controller.abort(),
    );
  } finally {
    options.signal?.removeEventListener("abort", forwardAbort);
    for (const url of slideUrls.values()) URL.revokeObjectURL(url);
  }
}
