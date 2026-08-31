"use client";

import {
  type StudioV3BrandKit,
  type StudioV3Item,
  type StudioV3LeadVariables,
  type StudioV3Timeline,
  resolveStudioV3Text,
  studioV3ActiveItems,
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

type Resource = {
  image?: HTMLImageElement;
  media?: HTMLMediaElement;
  gain?: GainNode;
  sourceNode?: MediaElementAudioSourceNode;
  url: string;
};

const clamp = (n: number, min = 0, max = 1) => Math.min(Math.max(n, min), max);
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Render abgebrochen", "AbortError");
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function mp4Mime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || null;
}

export function supportsRealtimeMp4Renderer() {
  return typeof window !== "undefined" && typeof HTMLCanvasElement !== "undefined" && Boolean(mp4Mime());
}

function loadImage(url: string) {
  return withTimeout(
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Bild konnte nicht geladen werden: ${url}`));
      img.src = url;
    }),
    20000,
    "Bild-Asset Timeout nach 20 Sekunden.",
  );
}

function loadMedia(url: string, audioOnly = false) {
  return withTimeout(
    new Promise<HTMLMediaElement>((resolve, reject) => {
      const element = document.createElement(audioOnly ? "audio" : "video") as HTMLMediaElement;
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.onloadedmetadata = () => resolve(element);
      element.onerror = () => reject(new Error(`Medium konnte nicht geladen werden: ${url}`));
      element.src = url;
      element.load();
    }),
    30000,
    "Video-Asset Timeout nach 30 Sekunden.",
  );
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
  const value = (key: string, fallback: number) => {
    const a = Number((before as Record<string, unknown>)[key] ?? fallback);
    const b = Number((after as Record<string, unknown>)[key] ?? a);
    return a + (b - a) * p;
  };
  return {
    x: value("x", base.x),
    y: value("y", base.y),
    scale: value("scale", base.scale),
    opacity: value("opacity", base.opacity),
    scrollY: value("scrollY", 0),
  };
}

function animation(item: StudioV3Item, timeMs: number) {
  const local = timeMs - item.startMs;
  const remain = item.endMs - timeMs;
  const duration = Math.max(1, item.animationDurationMs || 350);
  let opacity = 1;
  let x = 0;
  let y = 0;
  let scale = 1;
  const apply = (kind: string, progress: number, incoming: boolean) => {
    const q = clamp(progress);
    if (kind === "fade") opacity *= q;
    if (kind === "slide-up") y += (1 - q) * (incoming ? 28 : -18);
    if (kind === "slide-left") x += (1 - q) * (incoming ? 34 : -22);
    if (kind === "zoom") scale *= 0.88 + 0.12 * q;
    if (kind === "pop") scale *= 0.72 + 0.28 * Math.min(1, q * 1.25);
  };
  if (local < duration) apply(item.animationIn || "none", local / duration, true);
  if (remain < duration) apply(item.animationOut || "none", remain / duration, false);
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
  const targetRatio = w / h;
  if (fit === "cover") {
    let sx = 0;
    let sy = 0;
    let sourceW = sw;
    let sourceH = sh;
    if (sourceRatio > targetRatio) {
      sourceW = sh * targetRatio;
      sx = (sw - sourceW) / 2;
    } else {
      sourceH = sw / targetRatio;
      sy = (sh - sourceH) / 2;
    }
    ctx.drawImage(source, sx, sy, sourceW, sourceH, x, y, w, h);
    return;
  }
  let drawW = w;
  let drawH = h;
  if (sourceRatio > targetRatio) drawH = w / sourceRatio;
  else drawW = h * sourceRatio;
  ctx.drawImage(source, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
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

function drawText(ctx: CanvasRenderingContext2D, item: StudioV3Item, brand: StudioV3BrandKit, variables: StudioV3LeadVariables, w: number, h: number) {
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
  } else if (resource?.image) {
    if (item.type === "website") {
      const img = resource.image;
      const viewRatio = w / h;
      const cropH = Math.min(img.naturalHeight, img.naturalWidth / viewRatio);
      const maxY = Math.max(0, img.naturalHeight - cropH);
      const sy = maxY * clamp(s.scrollY / 100);
      ctx.drawImage(img, 0, sy, img.naturalWidth, cropH, 0, 0, w, h);
    } else drawCover(ctx, resource.image, 0, 0, w, h, resource.image.naturalWidth, resource.image.naturalHeight, item.fit);
  } else if (resource?.media instanceof HTMLVideoElement) {
    if (resource.media.videoWidth && resource.media.videoHeight) {
      drawCover(ctx, resource.media, 0, 0, w, h, resource.media.videoWidth, resource.media.videoHeight, item.fit);
    }
  }
  ctx.restore();
}

async function prepare(options: Options, audio: AudioContext, destination: MediaStreamAudioDestinationNode, warnings: string[]) {
  const resources = new Map<string, Resource>();
  const items = options.timeline.tracks.flatMap((track) => track.items).filter((item) => !item.hidden);
  let done = 0;
  for (const item of items) {
    abortIfNeeded(options.signal);
    const url = options.resolveSource(item) || item.sourceUrl;
    if (!url || resources.has(item.id)) {
      done += 1;
      continue;
    }
    try {
      if (["image", "logo", "map", "website"].includes(item.type)) {
        resources.set(item.id, { image: await loadImage(url), url });
      } else if (["video", "presenter", "audio"].includes(item.type)) {
        const media = await loadMedia(url, item.type === "audio");
        const gain = audio.createGain();
        gain.gain.value = 0;
        let sourceNode: MediaElementAudioSourceNode | undefined;
        try {
          sourceNode = audio.createMediaElementSource(media);
          sourceNode.connect(gain);
          gain.connect(destination);
        } catch {
          warnings.push(`${item.label}: Audio konnte nicht in den Render-Mix eingebunden werden.`);
        }
        resources.set(item.id, { media, gain, sourceNode, url });
      }
    } catch (error) {
      const critical = ["website", "video", "presenter"].includes(item.type);
      const message = `${item.label}: ${error instanceof Error ? error.message : "Asset konnte nicht geladen werden."}`;
      if (critical) throw new Error(message);
      warnings.push(message);
    }
    done += 1;
    options.onProgress?.(Math.min(8, 2 + Math.round((done / Math.max(1, items.length)) * 6)));
  }
  return resources;
}

export async function renderStudioV3Realtime(options: Options): Promise<RenderResult> {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") throw new Error("Realtime-Renderer wird von diesem Browser nicht unterstützt.");
  const mimeType = mp4Mime();
  if (!mimeType) throw new Error("Realtime-MP4 wird von diesem Browser nicht unterstützt.");
  abortIfNeeded(options.signal);

  const duration = Math.max(1000, options.timeline.durationMs);
  const ratio = options.timeline.width / options.timeline.height;
  const width = Math.min(options.maxWidth || 960, options.timeline.width);
  const height = Math.round(width / ratio);
  const fps = Math.max(20, Math.min(25, Math.round(options.timeline.fps || 25)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Render-Canvas konnte nicht initialisiert werden.");

  const audio = new AudioContext();
  await audio.resume().catch(() => undefined);
  const destination = audio.createMediaStreamDestination();
  const warnings: string[] = [];
  options.onProgress?.(1);
  const resources = await prepare(options, audio, destination, warnings);
  abortIfNeeded(options.signal);

  const stream = canvas.captureStream(fps);
  for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_650_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("MediaRecorder konnte das MP4 nicht fertigstellen."));
  });

  recorder.start(1000);
  const startedAt = performance.now();
  const mediaActive = new Map<string, boolean>();
  let lastReported = -1;
  options.onProgress?.(9);

  try {
    while (true) {
      abortIfNeeded(options.signal);
      const elapsed = Math.min(duration, performance.now() - startedAt);
      ctx.fillStyle = options.timeline.backgroundColor || "#000000";
      ctx.fillRect(0, 0, width, height);

      const active = studioV3ActiveItems(options.timeline, elapsed);
      const activeIds = new Set(active.map((item) => item.id));
      for (const [id, resource] of resources) {
        if (!resource.media) continue;
        const item = options.timeline.tracks.flatMap((track) => track.items).find((candidate) => candidate.id === id);
        if (!item) continue;
        const isActive = activeIds.has(id);
        if (resource.gain) resource.gain.gain.value = isActive && !item.muted ? item.volume ?? 1 : 0;
        if (isActive) {
          const relative = Math.max(0, ((elapsed - item.startMs) / 1000) * (item.playbackRate || 1));
          if (Math.abs(resource.media.currentTime - relative) > 0.28) {
            try {
              resource.media.currentTime = Math.min(relative, Math.max(0, (resource.media.duration || relative + 0.1) - 0.05));
            } catch {}
          }
          resource.media.playbackRate = item.playbackRate || 1;
          if (!mediaActive.get(id)) {
            void resource.media.play().catch(() => undefined);
            mediaActive.set(id, true);
          }
        } else if (mediaActive.get(id)) {
          resource.media.pause();
          mediaActive.set(id, false);
        }
      }

      for (const item of active) {
        if (item.type === "audio") continue;
        drawItem(ctx, item, elapsed, resources.get(item.id), options.brand, options.variables, width, height);
      }

      const timelineProgress = Math.floor((elapsed / duration) * 100);
      const progress = Math.min(99, 10 + Math.floor(timelineProgress * 0.89));
      if (progress !== lastReported) {
        lastReported = progress;
        options.onProgress?.(progress);
      }
      if (elapsed >= duration) break;
      await sleep(Math.max(10, Math.round(1000 / fps / 2)));
    }

    recorder.stop();
    await withTimeout(stopped, 15000, "MP4-Finalisierung Timeout nach 15 Sekunden.");
    const blob = new Blob(chunks, { type: "video/mp4" });
    if (!blob.size) throw new Error("Das gerenderte MP4 ist leer.");
    options.onProgress?.(100);
    return { blob, format: "mp4", mimeType: "video/mp4", warnings: [...new Set(warnings)], width, height };
  } finally {
    for (const resource of resources.values()) {
      resource.media?.pause();
      if (resource.media) resource.media.src = "";
    }
    if (recorder.state !== "inactive") recorder.stop();
    for (const track of stream.getTracks()) track.stop();
    await audio.close().catch(() => undefined);
  }
}
