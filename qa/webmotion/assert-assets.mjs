import { chromium } from "playwright";

const storage = "https://jiahshldcusphxtbqxpv.supabase.co/storage/v1/object/public/energy-media/1b6c9d54-48c7-4bda-bac0-5ede3c71e197/template-slides";
const slides = [
  "bd91683f-15b1-464a-bbe1-9aeea72b6719-energiekosten-slide-01-capture.webp",
  "beb727d7-6f53-42e4-9e26-6862fb432790-energiekosten-slide-02-capture.webp",
  "4ff3c801-99e8-4dac-a1bc-a7f43b8b9937-energiekosten-slide-03-capture.webp",
  "8ebb9736-2d51-4c86-8822-dd322db83c43-energiekosten-slide-04-capture.webp",
  "8e7e31b9-8386-452f-958f-62daf6b0712a-energiekosten-slide-05-capture.webp",
  "f0a7e3b3-013e-4c5e-bb0a-2fbd82858465-energiekosten-slide-06-capture.webp",
  "2b9ef9c4-88eb-4c52-b5ea-e967a698c6ce-energiekosten-slide-07-capture.webp",
  "c3549308-0fa3-42f9-9921-a64820f32506-energiekosten-slide-08-capture.webp",
];

const failures = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [index, file] of slides.entries()) {
    const url = `${storage}/${file}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get("content-type") || "";
      if (!type.toLowerCase().includes("image/webp")) throw new Error(`unerwarteter Content-Type: ${type || "leer"}`);
      const bytes = Buffer.from(await response.arrayBuffer()).length;
      if (bytes < 20_000) throw new Error(`Datei auffällig klein (${bytes} Bytes)`);

      const decoded = await page.evaluate(async (src) => {
        return await new Promise((resolve) => {
          const image = new Image();
          image.crossOrigin = "anonymous";
          const timer = window.setTimeout(() => resolve({ ok: false, error: "Browser-Decode Timeout" }), 20_000);
          image.onload = () => {
            window.clearTimeout(timer);
            resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight });
          };
          image.onerror = () => {
            window.clearTimeout(timer);
            resolve({ ok: false, error: "Browser konnte WebP nicht decodieren" });
          };
          image.src = src;
        });
      }, url);

      if (!decoded.ok) throw new Error(decoded.error || "Browser-Decode fehlgeschlagen");
      if (decoded.width !== 1280 || decoded.height !== 720) {
        throw new Error(`falsche decodierte Größe ${decoded.width}x${decoded.height}, erwartet 1280x720`);
      }
      process.stdout.write(`✓ Slide ${index + 1}: ${decoded.width}x${decoded.height}, ${Math.round(bytes / 1024)} KB, Browser-Decode OK\n`);
    } catch (error) {
      failures.push(`Slide ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nEnergiekosten Asset-Preflight fehlgeschlagen:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\n✓ Alle 8 Energiekosten-Production-Assets sind erreichbar, im Chromium decodierbar und exakt 1280x720.");
