"use client";

import "@superhq/webmotion/elements";
import { type FrameContext, WComposition } from "@superhq/webmotion/elements";
import { VideoSource } from "@superhq/webmotion/video";
import {
  StudioV3BrandKit,
  StudioV3Item,
  StudioV3LeadVariables,
  StudioV3Timeline,
  resolveStudioV3Text,
  studioV3AllItems,
} from "@/lib/studio-v3";

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

type Resource = { image?: HTMLImageElement; video?: VideoSource; url: string };
type VisualLayer = { kind: "canvas"; items: StudioV3Item[] } | { kind: "video"; item: StudioV3Item };
type LiveLayerElement = HTMLElement & {
  wmLiveCanvas: () => HTMLCanvasElement | null;
  wmApplyFrame: (ctx: FrameContext) => void;
  wmAwaitFrame?: () => Promise<void>;
};

const clamp = (n: number, min = 0, max = 1) => Math.min(Math.max(n, min), max);
const isVideo = (item: StudioV3Item) => item.type === "video" || item.type === "presenter";
const isAudio = (item: StudioV3Item) => item.type === "audio";

function assertWebCodecs() {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("Dieser Browser unterstützt den deterministischen WebCodecs-Renderer nicht.");
  }
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Render abgebrochen", "AbortError");
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild konnte nicht geladen werden: ${url}`));
    img.src = url;
  });
}

function state(item: StudioV3Item, timeMs: number) {
  const base = { x: item.transform.x, y: item.transform.y, scale: item.transform.scale, opacity: item.transform.opacity, scrollY: 0 };
  const frames = [...(item.keyframes || [])].sort((a, b) => a.atMs - b.atMs);
  if (!frames.length) return base;
  let before = frames[0];
  let after = frames[frames.length - 1];
  for (const frame of frames) {
    if (frame.atMs <= timeMs) before = frame;
    if (frame.atMs >= timeMs) {
      after = frame;
      break;
    }
  }
  const p = before === after ? 0 : clamp((timeMs - before.atMs) / Math.max(1, after.atMs - before.atMs));
  const val = (key: string, fallback: number) => {
    const a = Number((before as Record<string, unknown>)[key] ?? fallback);
    const b = Number((after as Record<string, unknown>)[key] ?? a);
    return a + (b - a) * p;
  };
  return { x: val("x", base.x), y: val("y", base.y), scale: val("scale", base.scale), opacity: val("opacity", base.opacity), scrollY: val("scrollY", 0) };
}

function animation(item: StudioV3Item, timeMs: number) {
  const local = timeMs - item.startMs;
  const remain = item.endMs - timeMs;
  const d = Math.max(1, item.animationDurationMs || 350);
  let opacity = 1;
  let x = 0;
  let y = 0;
  let scale = 1;
  const apply = (kind: string, p: number, incoming: boolean) => {
    const q = clamp(p);
    if (kind === "fade") opacity *= q;
    if (kind === "slide-up") y += (1 - q) * (incoming ? 28 : -18);
    if (kind === "slide-left") x += (1 - q) * (incoming ? 34 : -22);
    if (kind === "zoom") scale *= 0.88 + 0.12 * q;
    if (kind === "pop") scale *= 0.72 + 0.28 * Math.min(1, q * 1.25);
  };
  if (local < d) apply(item.animationIn || "none", local / d, true);
  if (remain < d) apply(item.animationOut || "none", remain / d, false);
  return { opacity, x, y, scale };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  sw: number,
  sh: number,
  fit = "cover",
) {
  if (fit === "fill") {
    ctx.drawImage(source, x, y, w, h);
    return;
  }
  const sourceRatio = sw / sh;
  const target = w / h;
  let dw = w;
  let dh = h;
  if ((fit === "cover" && sourceRatio > target) || (fit === "contain" && sourceRatio < target)) {
    dh = h;
    dw = h * sourceRatio;
  } else {
    dw = w;
    dh = w / sourceRatio;
  }
  if (fit === "cover") {
    let sx = 0;
    let sy = 0;
    let sww = sw;
    let shh = sh;
    if (sourceRatio > target) {
      sww = sh * target;
      sx = (sw - sww) / 2;
    } else {
      shh = sw / target;
      sy = (sh - shh) / 2;
    }
    ctx.drawImage(source, sx, sy, sww, shh, x, y, w, h);
  } else {
    ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  item: StudioV3Item,
  brand: StudioV3BrandKit,
  variables: StudioV3LeadVariables,
  w: number,
  h: number,
) {
  const padding = Math.min(w, h) * 0.08;
  if (item.backgroundColor) {
    ctx.fillStyle = item.backgroundColor;
    roundRect(ctx, 0, 0, w, h, item.transform.borderRadius);
    ctx.fill();
  }
  if (item.borderWidth) {
    ctx.strokeStyle = item.borderColor || brand.accentColor;
    ctx.lineWidth = item.borderWidth;
    roundRect(ctx, item.borderWidth / 2, item.borderWidth / 2, w - item.borderWidth, h - item.borderWidth, item.transform.borderRadius);
    ctx.stroke();
  }
  const text = resolveStudioV3Text(item.text || "", variables);
  const sub = resolveStudioV3Text(item.subtext || "", variables);
  const fontSize = Math.max(12, item.fontSize || 40);
  ctx.fillStyle = item.color || brand.textColor;
  ctx.font = `${item.fontWeight || 800} ${fontSize}px ${item.fontFamily || brand.fontHeading}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = item.textAlign || "left";
  const max = w - padding * 2;
  const lines = wrap(ctx, text, max).slice(0, 4);
  const subSize = Math.max(11, fontSize * 0.56);
  const total = lines.length * fontSize * (item.lineHeight || 1.05) + (sub ? subSize * 1.6 : 0);
  let y = (h - total) / 2 + fontSize / 2;
  const x = item.textAlign === "center" ? w / 2 : item.textAlign === "right" ? w - padding : padding;
  for (const line of lines) {
    ctx.fillText(line, x, y, max);
    y += fontSize * (item.lineHeight || 1.05);
  }
  if (sub) {
    ctx.globalAlpha *= 0.74;
    ctx.font = `650 ${subSize}px ${brand.fontBody}`;
    ctx.fillText(sub, x, y + subSize * 0.65, max);
  }
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  item: StudioV3Item,
  timeMs: number,
  resource: Resource | undefined,
  videoFrame: VideoFrame | null,
  brand: StudioV3BrandKit,
  variables: StudioV3LeadVariables,
  canvasW: number,
  canvasH: number,
) {
  const s = state(item, timeMs);
  const a = animation(item, timeMs);
  const x = (s.x / 100) * canvasW;
  const y = (s.y / 100) * canvasH;
  const w = (item.transform.width / 100) * canvasW;
  const h = (item.transform.height / 100) * canvasH;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  ctx.globalAlpha = clamp(s.opacity * a.opacity);
  ctx.translate(cx + a.x, cy + a.y);
  ctx.rotate((item.transform.rotation * Math.PI) / 180);
  ctx.scale(s.scale * a.scale, s.scale * a.scale);
  ctx.translate(-w / 2, -h / 2);
  if (item.shadow && item.shadow !== "none") {
    ctx.shadowColor = "rgba(0,0,0,.28)";
    ctx.shadowBlur = item.shadow === "strong" ? 35 : 18;
    ctx.shadowOffsetY = item.shadow === "strong" ? 18 : 9;
  }
  roundRect(ctx, 0, 0, w, h, item.transform.borderRadius);
  ctx.clip();
  if (item.type === "text" || item.type === "metric") drawText(ctx, item, brand, variables, w, h);
  else if (item.type === "shape") {
    ctx.fillStyle = item.backgroundColor || brand.accentColor;
    if (item.shape === "circle") {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(0, 0, w, h);
  } else if (videoFrame) {
    drawCover(ctx, videoFrame, 0, 0, w, h, videoFrame.displayWidth, videoFrame.displayHeight, item.fit);
  } else if (resource?.image) {
    if (item.type === "website") {
      const img = resource.image;
      const viewRatio = w / h;
      const cropH = Math.min(img.naturalHeight, img.naturalWidth / viewRatio);
      const maxY = Math.max(0, img.naturalHeight - cropH);
      const sy = maxY * clamp(s.scrollY / 100);
      ctx.drawImage(img, 0, sy, img.naturalWidth, cropH, 0, 0, w, h);
    } else drawCover(ctx, resource.image, 0, 0, w, h, resource.image.naturalWidth, resource.image.naturalHeight, item.fit);
  }
  ctx.restore();
}

async function prepare(options: Options, warnings: string[]) {
  const resources = new Map<string, Resource>();
  for (const item of studioV3AllItems(options.timeline)) {
    if (isAudio(item)) continue;
    const url = options.resolveSource(item) || item.sourceUrl;
    if (!url || resources.has(item.id)) continue;
    try {
      if (isVideo(item)) resources.set(item.id, { video: await VideoSource.create(url), url });
      else if (["image", "logo", "map", "website"].includes(item.type)) resources.set(item.id, { image: await loadImage(url), url });
    } catch (error) {
      warnings.push(`${item.label}: Asset konnte nicht für WebMotion vorbereitet werden (${error instanceof Error ? error.message : "unbekannter Fehler"}).`);
    }
  }
  return resources;
}

function makeVisualLayers(items: StudioV3Item[]): VisualLayer[] {
  const layers: VisualLayer[] = [];
  let canvasItems: StudioV3Item[] = [];
  const flush = () => {
    if (!canvasItems.length) return;
    layers.push({ kind: "canvas", items: canvasItems });
    canvasItems = [];
  };
  for (const item of items) {
    if (isAudio(item)) continue;
    if (isVideo(item)) {
      flush();
      layers.push({ kind: "video", item });
    } else canvasItems.push(item);
  }
  flush();
  return layers;
}

function appendSequence(comp: HTMLElement, fromFrame: number, durationFrames: number, label?: string) {
  const sequence = document.createElement("w-sequence");
  sequence.setAttribute("from", String(Math.max(0, fromFrame)));
  sequence.setAttribute("duration", String(Math.max(1, durationFrames)));
  if (label) sequence.setAttribute("label", label);
  comp.appendChild(sequence);
  return sequence;
}

function makeLiveCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("WebMotion-Layer konnte nicht initialisiert werden.");
  return { canvas, ctx };
}

function addStaticLayer(
  comp: HTMLElement,
  items: StudioV3Item[],
  resources: Map<string, Resource>,
  options: Options,
  width: number,
  height: number,
) {
  const fps = options.timeline.fps;
  const firstMs = Math.min(...items.map((item) => item.startMs));
  const lastMs = Math.max(...items.map((item) => item.endMs));
  const fromFrame = Math.floor((firstMs / 1000) * fps);
  const endFrame = Math.ceil((lastMs / 1000) * fps);
  const sequence = appendSequence(comp, fromFrame, endFrame - fromFrame, `Canvas ${items[0]?.label || "Layer"}`);
  const host = document.createElement("w-el") as LiveLayerElement;
  host.setAttribute("x", "0");
  host.setAttribute("y", "0");
  host.setAttribute("width", String(width));
  host.setAttribute("height", String(height));
  const { canvas, ctx } = makeLiveCanvas(width, height);
  host.wmLiveCanvas = () => canvas;
  host.wmApplyFrame = (frame) => {
    const timeMs = (frame.globalFrame / fps) * 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const item of items) {
      if (timeMs < item.startMs || timeMs >= item.endMs) continue;
      drawItem(ctx, item, timeMs, resources.get(item.id), null, options.brand, options.variables, width, height);
    }
  };
  sequence.appendChild(host);
}

function addVideoLayer(
  comp: HTMLElement,
  item: StudioV3Item,
  resource: Resource | undefined,
  options: Options,
  width: number,
  height: number,
  warnings: string[],
) {
  const fps = options.timeline.fps;
  const fromFrame = Math.floor((item.startMs / 1000) * fps);
  const endFrame = Math.ceil((item.endMs / 1000) * fps);
  const sequence = appendSequence(comp, fromFrame, endFrame - fromFrame, item.label);
  const host = document.createElement("w-el") as LiveLayerElement;
  host.setAttribute("x", "0");
  host.setAttribute("y", "0");
  host.setAttribute("width", String(width));
  host.setAttribute("height", String(height));
  const { canvas, ctx } = makeLiveCanvas(width, height);
  let pending = Promise.resolve();
  let lastTimestamp = Number.NaN;
  host.wmLiveCanvas = () => canvas;
  host.wmAwaitFrame = () => pending;
  host.wmApplyFrame = (frame) => {
    abortIfNeeded(options.signal);
    const timeMs = (frame.globalFrame / fps) * 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!resource?.video || timeMs < item.startMs || timeMs >= item.endMs) return;
    const sourceTime = Math.min(
      Math.max(0, ((timeMs - item.startMs) / 1000) * (item.playbackRate || 1)),
      Math.max(0, resource.video.durationSec - 1e-4),
    );
    const timestamp = resource.video.targetTimestamp(sourceTime);
    if (timestamp === lastTimestamp) return;
    lastTimestamp = timestamp;
    pending = resource.video
      .frameAtTime(sourceTime)
      .then((videoFrame) => {
        abortIfNeeded(options.signal);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (videoFrame) drawItem(ctx, item, timeMs, resource, videoFrame, options.brand, options.variables, width, height);
      })
      .catch((error) => {
        warnings.push(`${item.label}: Frame konnte nicht decodiert werden (${error instanceof Error ? error.message : "unbekannter Fehler"}).`);
        throw error;
      });
  };
  sequence.appendChild(host);
}

function addAudio(comp: HTMLElement, item: StudioV3Item, url: string, fps: number, warnings: string[]) {
  if (item.muted || (item.volume ?? 1) <= 0) return;
  const fromFrame = Math.floor((item.startMs / 1000) * fps);
  const endFrame = Math.ceil((item.endMs / 1000) * fps);
  const sequence = appendSequence(comp, fromFrame, endFrame - fromFrame, `Audio ${item.label}`);
  const audio = document.createElement("w-audio");
  audio.setAttribute("src", url);
  audio.setAttribute("gain", String(item.volume ?? 1));
  sequence.appendChild(audio);
  if ((item.playbackRate || 1) !== 1) warnings.push(`${item.label}: WebMotion mischt Audio derzeit mit natürlicher Geschwindigkeit; Bild bleibt framegenau bei ${item.playbackRate}x.`);
}

export async function renderStudioV3Browser(options: Options): Promise<RenderResult> {
  assertWebCodecs();
  abortIfNeeded(options.signal);
  const duration = Math.max(1000, options.timeline.durationMs);
  const ratio = options.timeline.width / options.timeline.height;
  const width = Math.min(options.maxWidth || 1920, options.timeline.width);
  const height = Math.round(width / ratio);
  const fps = Math.max(1, Math.round(options.timeline.fps || 30));
  const durationFrames = Math.max(1, Math.ceil((duration / 1000) * fps));
  const warnings: string[] = [];
  const resources = await prepare(options, warnings);
  abortIfNeeded(options.signal);

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-2147483647";
  document.body.appendChild(host);

  const comp = document.createElement("w-composition") as WComposition;
  comp.setAttribute("width", String(width));
  comp.setAttribute("height", String(height));
  comp.setAttribute("fps", String(fps));
  comp.setAttribute("duration", String(durationFrames));
  comp.setAttribute("background", options.timeline.backgroundColor || "#000000");

  const allItems = studioV3AllItems(options.timeline);
  for (const layer of makeVisualLayers(allItems)) {
    if (layer.kind === "canvas") addStaticLayer(comp, layer.items, resources, options, width, height);
    else addVideoLayer(comp, layer.item, resources.get(layer.item.id), options, width, height, warnings);
  }
  for (const item of allItems) {
    if (!isAudio(item)) continue;
    const url = options.resolveSource(item) || item.sourceUrl;
    if (url) addAudio(comp, item, url, fps, warnings);
  }
  for (const item of allItems) {
    if (!isVideo(item) || item.muted || (item.volume ?? 1) <= 0) continue;
    const url = options.resolveSource(item) || item.sourceUrl;
    if (url) addAudio(comp, item, url, fps, warnings);
  }

  host.appendChild(comp);
  let lastReported = -1;
  try {
    await comp.ready;
    if (document.fonts?.ready) await document.fonts.ready;
    abortIfNeeded(options.signal);
    const blob = await comp.export({
      bitrate: width >= 1800 ? 8_000_000 : 4_500_000,
      onProgress: ({ frame, total }) => {
        abortIfNeeded(options.signal);
        const progress = Math.max(0, Math.min(100, Math.round(((frame + 1) / Math.max(1, total)) * 100)));
        if (progress !== lastReported) {
          lastReported = progress;
          options.onProgress?.(progress);
        }
      },
    });
    options.onProgress?.(100);
    return { blob, format: "mp4", mimeType: "video/mp4", warnings: [...new Set(warnings)], width, height };
  } finally {
    comp.pause();
    host.remove();
    for (const resource of resources.values()) resource.video?.close();
  }
}
