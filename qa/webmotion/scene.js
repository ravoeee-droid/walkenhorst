const fps = 30;
const sprite = "/public/assets/energiekosten/production-sprite.webp";
const beats = [
  { label: "Website", from: 0, to: 14200, kind: "website" },
  { label: "Slide 1", from: 14200, to: 25200, slide: 0 },
  { label: "Slide 2", from: 25200, to: 36200, slide: 1 },
  { label: "Slide 3", from: 36200, to: 46200, slide: 2 },
  { label: "Slide 4", from: 46200, to: 58200, slide: 3 },
  { label: "Slide 5", from: 58200, to: 69200, slide: 4 },
  { label: "Slide 6", from: 69200, to: 82200, slide: 5 },
  { label: "Slide 7", from: 82200, to: 93200, slide: 6 },
  { label: "Slide 8", from: 93200, to: 107000, slide: 7 },
];

const frame = (ms) => Math.round((ms / 1000) * fps);

export const config = {
  width: 1280,
  height: 720,
  fps,
  duration: frame(107000),
  background: "#101110",
  downloadName: "walkenhorst-energiekosten-qa.mp4",
};

function slideMarkup(beat) {
  if (beat.kind === "website") {
    return `
      <w-el x="0" y="0" width="1280" height="720" style="background:#f4f1ea;display:grid;place-items:center;font-family:Arial,sans-serif;color:#111">
        <div style="text-align:center;max-width:780px;padding:50px">
          <div style="font-size:19px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#a77b13">Walkenhorst Energie</div>
          <div style="font-size:52px;line-height:1.04;font-weight:850;margin-top:18px">Website-Analyse · personalisierter Einstieg</div>
          <div style="font-size:23px;line-height:1.45;color:#5f625e;margin-top:20px">Der echte Website-Capture wird pro Lead im Render-Preflight geprüft. Diese QA-Komposition sichert die Master-Timeline und alle acht Production-Slides.</div>
        </div>
      </w-el>`;
  }
  const col = beat.slide % 2;
  const row = Math.floor(beat.slide / 2);
  return `
    <w-el x="0" y="0" width="1280" height="720" style="overflow:hidden;background:#111">
      <img src="${sprite}" alt="${beat.label}" style="position:absolute;left:${-col * 1280}px;top:${-row * 720}px;width:2560px;height:2880px;max-width:none;max-height:none" />
    </w-el>`;
}

export const scene = `
<style>
  w-composition { font-family: Arial, Helvetica, sans-serif; }
  img { display:block; }
</style>
${beats
  .map(
    (beat) => `<w-sequence label="${beat.label}" from="${frame(beat.from)}" duration="${Math.max(1, frame(beat.to) - frame(beat.from))}">${slideMarkup(beat)}</w-sequence>`,
  )
  .join("\n")}
`;
