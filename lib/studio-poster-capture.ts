import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";
import { safeCaptureUrl } from "@/lib/studio-website-capture";

const WIDTH = 1920;
const HEIGHT = 1080;
const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

export async function captureStudioPoster(websiteCaptureUrl: string, presenterVideoUrl: string) {
  const website = await safeCaptureUrl(websiteCaptureUrl);
  const presenter = await safeCaptureUrl(presenterVideoUrl);
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(process.env.CHROMIUM_PACK_URL || CHROMIUM_PACK_URL);
  const args = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
  const browser = await puppeteer.launch({
    args,
    executablePath,
    headless: "shell",
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, hasTouch: false, isLandscape: true, isMobile: false },
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(50000);
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07192a}
      *{box-sizing:border-box}
      #poster{position:relative;width:1920px;height:1080px;overflow:hidden;background:#07192a}
      #site{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
      #shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,17,30,.02),rgba(3,17,30,.10))}
      #presenter{position:absolute;right:4.5%;bottom:6%;width:12.5%;aspect-ratio:1/1;height:auto;object-fit:cover;object-position:center 22%;border-radius:50%;border:3px solid rgba(255,255,255,.96);background:#d9e2e7;box-shadow:0 12px 34px rgba(0,0,0,.30)}
      #play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;place-items:center;width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.94);color:#07192a;box-shadow:0 12px 34px rgba(0,0,0,.24);font:700 28px/1 Arial,sans-serif;padding-left:4px}
    </style></head><body><div id="poster"><img id="site" alt=""><div id="shade"></div><video id="presenter" muted playsinline preload="auto"></video><div id="play">▶</div></div></body></html>`, { waitUntil: "domcontentloaded" });

    await page.evaluate(async ({ website, presenter }) => {
      const image = document.getElementById("site") as HTMLImageElement | null;
      const video = document.getElementById("presenter") as HTMLVideoElement | null;
      if (!image || !video) throw new Error("Poster-Elemente fehlen.");

      const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Poster-Asset Timeout")), ms));
      const imageReady = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Website-Capture konnte nicht geladen werden."));
        image.src = website;
        if (image.complete && image.naturalWidth > 0) resolve();
      });
      await Promise.race([imageReady, timeout(45000)]);

      const videoReady = new Promise<void>((resolve, reject) => {
        const done = () => {
          try {
            const target = Math.min(0.08, Math.max(0, (video.duration || 1) - 0.02));
            if (target <= 0.001) { video.pause(); resolve(); return; }
            const onSeeked = () => { video.pause(); resolve(); };
            video.addEventListener("seeked", onSeeked, { once: true });
            video.currentTime = target;
          } catch {
            video.pause();
            resolve();
          }
        };
        video.addEventListener("loadeddata", done, { once: true });
        video.addEventListener("error", () => reject(new Error("Presenter-Video konnte nicht geladen werden.")), { once: true });
        video.src = presenter;
        video.load();
      });
      await Promise.race([videoReady, timeout(20000)]);
    }, { website, presenter });

    const image = await page.screenshot({
      type: "webp",
      quality: 90,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    if (image.byteLength < 5000) throw new Error("Der erzeugte Video-Poster ist leer oder beschädigt.");
    return { buffer: Buffer.from(image), width: WIDTH, height: HEIGHT };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
