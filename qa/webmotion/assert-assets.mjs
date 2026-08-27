const storage = "https://jiahshldcusphxtbqxpv.supabase.co/storage/v1/object/public/energy-media/1b6c9d54-48c7-4bda-bac0-5ede3c71e197/template-slides";
const slides = [
  "70c35ad9-2b6f-4009-b606-e6040e1b159d-energiekosten-clean-01.png",
  "f4378915-6896-4fec-a01d-83ee7213f5b5-energiekosten-clean-02.png",
  "6570da32-d578-4d10-895c-a98ef74d2a2b-energiekosten-clean-03.png",
  "4b5b0592-f7df-4e8d-bb0f-68a4ad3e6b36-energiekosten-clean-04.png",
  "6be6f532-278a-4096-9c7b-586421222e85-energiekosten-clean-05.png",
  "81dc95b4-5f15-4bd4-bf6f-3b336494a1b4-energiekosten-clean-06.png",
  "436da12b-d3ee-48d4-91b5-801b33a5b427-energiekosten-clean-07.png",
  "36b2ce21-414d-4014-9519-e3e7cac0ccd5-energiekosten-clean-08.png",
];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG)) throw new Error("kein gültiger PNG-Header");
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("PNG enthält keinen IHDR-Block");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const failures = [];
for (const [index, file] of slides.entries()) {
  const url = `${storage}/${file}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("image/png")) throw new Error(`unerwarteter Content-Type: ${type || "leer"}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const { width, height } = pngSize(buffer);
    if (width !== 1672 || height !== 941) throw new Error(`falsche Größe ${width}x${height}, erwartet 1672x941`);
    if (buffer.length < 20_000) throw new Error(`Datei auffällig klein (${buffer.length} Bytes)`);
    process.stdout.write(`✓ Slide ${index + 1}: ${width}x${height}, ${Math.round(buffer.length / 1024)} KB\n`);
  } catch (error) {
    failures.push(`Slide ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error("\nEnergiekosten Asset-Preflight fehlgeschlagen:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\n✓ Alle 8 Energiekosten-Master-Assets sind erreichbar, decodierbar und dimensionsrichtig.");
