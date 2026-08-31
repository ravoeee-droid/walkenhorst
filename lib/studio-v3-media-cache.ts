"use client";

import type { StudioV3Item, StudioV3Timeline } from "@/lib/studio-v3";

type ResolveSource = (item: StudioV3Item) => string | null;
type Progress = (value: number) => void;

const objectUrls = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const CACHE_NAME = "walkenhorst-render-media-v2";

function abortError() {
  return new DOMException("Render abgebrochen", "AbortError");
}

async function responseFromCache(url: string) {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url)) || null;
  } catch {
    return null;
  }
}

async function putCache(url: string, response: Response) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, response);
  } catch {
    // Rendering must still work when Cache Storage is unavailable/quota-limited.
  }
}

async function readResponse(response: Response, signal: AbortSignal | undefined, onProgress?: (fraction: number) => void) {
  if (!response.ok) throw new Error(`Presenter-Datei nicht erreichbar (${response.status}).`);
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body) {
    const blob = await response.blob();
    onProgress?.(1);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw abortError();
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) onProgress?.(Math.min(0.99, received / total));
      else onProgress?.(Math.min(0.92, chunks.length / 80));
    }
  }
  const type = response.headers.get("content-type") || "video/mp4";
  onProgress?.(1);
  return new Blob(chunks, { type });
}

async function materializeOne(url: string, signal?: AbortSignal, onProgress?: (fraction: number) => void) {
  const existing = objectUrls.get(url);
  if (existing) {
    onProgress?.(1);
    return existing;
  }
  const inflight = pending.get(url);
  if (inflight) return inflight;

  const task = (async () => {
    if (signal?.aborted) throw abortError();
    let cached = await responseFromCache(url);
    if (cached) {
      const blob = await cached.blob();
      const local = URL.createObjectURL(blob);
      objectUrls.set(url, local);
      onProgress?.(1);
      return local;
    }

    const response = await fetch(url, { mode: "cors", cache: "force-cache", signal });
    // Clone before consuming the body so the complete presenter file can be reused
    // by every lead without downloading the same 16+ MB source again.
    const clone = response.clone();
    const blob = await readResponse(response, signal, onProgress);
    void putCache(url, clone);
    const local = URL.createObjectURL(blob);
    objectUrls.set(url, local);
    return local;
  })().finally(() => pending.delete(url));

  pending.set(url, task);
  return task;
}

export async function materializeStudioVideoSources(
  timeline: StudioV3Timeline,
  resolveSource: ResolveSource,
  signal?: AbortSignal,
  report?: Progress,
) {
  const byUrl = new Map<string, StudioV3Item[]>();
  for (const item of timeline.tracks.flatMap((track) => track.items)) {
    if (item.hidden || !["video", "presenter", "audio"].includes(item.type)) continue;
    const url = resolveSource(item) || item.sourceUrl;
    if (!url || url.startsWith("blob:")) continue;
    const items = byUrl.get(url) || [];
    items.push(item);
    byUrl.set(url, items);
  }
  if (!byUrl.size) return resolveSource;

  const localByUrl = new Map<string, string>();
  const entries = Array.from(byUrl.entries());
  for (let index = 0; index < entries.length; index += 1) {
    const [url] = entries[index];
    const base = index / entries.length;
    const span = 1 / entries.length;
    const local = await materializeOne(url, signal, (fraction) => {
      // Reserve renderer progress 2–18 for one-time media preparation.
      report?.(2 + Math.round((base + fraction * span) * 16));
    });
    localByUrl.set(url, local);
  }
  report?.(18);

  return (item: StudioV3Item) => {
    const source = resolveSource(item) || item.sourceUrl;
    return source ? localByUrl.get(source) || source : null;
  };
}
