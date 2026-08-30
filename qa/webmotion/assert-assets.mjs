import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const storage = "https://jiahshldcusphxtbqxpv.supabase.co/storage/v1/object/public/energy-media/1b6c9d54-48c7-4bda-bac0-5ede3c71e197/template-slides";
const slides = [
  { file: "70c35ad9-2b6f-4009-b606-e6040e1b159d-energiekosten-clean-01.png", etag: "af2ccb8a5d6f6dbbde2aecbd23243e12" },
  { file: "f4378915-6896-4fec-a01d-83ee7213f5b5-energiekosten-clean-02.png", etag: "a990dc05737d6daba855b80299eed8fa" },
  { file: "6570da32-d578-4d10-895c-a98ef74d2a2b-energiekosten-clean-03.png", etag: "f7673461449a8f4f8b5ff62eb1b76b7a" },
  { file: "4b5b0592-f7df-4e8d-bb0f-68a4ad3e6b36-energiekosten-clean-04.png", etag: "994d2eadfe9eda07eaea7be778591b8c" },
  { file: "6be6f532-278a-4096-9c7b-586421222e85-energiekosten-clean-05.png", etag: "785a10000d7fc3a28c791178501176c0" },
  { file: "81dc95b4-5f15-4bd4-bf6f-3b336494a1b4-energiekosten-clean-06.png", etag: "c2b5bdca4aa611aac08b7739219358f1" },
  { file: "436da12b-d3ee-48d4-91b5-801b33a5b427-energiekosten-clean-07.png", etag: "ed024bfab85ff5cced9a39004a573a9d" },
  { file: "36b2ce21-414d-4014-9519-e3e7cac0ccd5-energiekosten-clean-08.png", etag: "13585f5cd066e3531c153278ee5d02c1" },
];

const cacheDir = path.resolve(".webmotion/assets");
await mkdir(cacheDir, { recursive: true });

const failures = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [index, asset] of slides.entries()) {
    const url = `${storage}/${asset.file}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get("content-type") || "";
      if (!type.toLowerCase().includes("image/png")) throw new Error(`unerwarteter Content-Type: ${type || "leer"}`);
      const etag = String(response.headers.get("etag") || "").replaceAll('"', "").trim().toLowerCase();
      if (etag && etag !== asset.etag) throw new Error(`Asset-Inhalt verändert: ETag ${etag}, erwartet ${asset.etag}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 40_000) throw new Error(`Datei auffällig klein (${buffer.length} Bytes)`);

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
            resolve({ ok: false, error: "Browser konnte PNG nicht decodieren" });
          };
          image.src = src;
        });
      }, url);

      if (!decoded.ok) throw new Error(decoded.error || "Browser-Decode fehlgeschlagen");
      if (decoded.width !== 1672 || decoded.height !== 941) {
        throw new Error(`falsche decodierte Größe ${decoded.width}x${decoded.height}, erwartet 1672x941`);
      }

      const localName = `energiekosten-${String(index + 1).padStart(2, "0")}.png`;
      await writeFile(path.join(cacheDir, localName), buffer);
      process.stdout.write(`✓ Clean Slide ${index + 1}: ${decoded.width}x${decoded.height}, ${Math.round(buffer.length / 1024)} KB, Content-Pin ${asset.etag.slice(0, 8)} → ${localName}\n`);
    } catch (error) {
      failures.push(`Slide ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nEnergiekosten Golden-Master-Preflight fehlgeschlagen:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\n✓ Alle 8 CLEAN Energiekosten-Originale sind content-gepinnt, im Chromium decodierbar und exakt 1672x941. Canva-Capture-Fallbacks sind nicht mehr zulässig.");
