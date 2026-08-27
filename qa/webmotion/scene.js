const fps = 30;
const storage = "https://jiahshldcusphxtbqxpv.supabase.co/storage/v1/object/public/energy-media/1b6c9d54-48c7-4bda-bac0-5ede3c71e197/template-slides";
const slides = [
  `${storage}/bd91683f-15b1-464a-bbe1-9aeea72b6719-energiekosten-slide-01-capture.webp`,
  `${storage}/beb727d7-6f53-42e4-9e26-6862fb432790-energiekosten-slide-02-capture.webp`,
  `${storage}/4ff3c801-99e8-4dac-a1bc-a7f43b8b9937-energiekosten-slide-03-capture.webp`,
  `${storage}/8ebb9736-2d51-4c86-8822-dd322db83c43-energiekosten-slide-04-capture.webp`,
  `${storage}/8e7e31b9-8386-452f-958f-62daf6b0712a-energiekosten-slide-05-capture.webp`,
  `${storage}/f0a7e3b3-013e-4c5e-bb0a-2fbd82858465-energiekosten-slide-06-capture.webp`,
  `${storage}/2b9ef9c4-88eb-4c52-b5ea-e967a698c6ce-energiekosten-slide-07-capture.webp`,
  `${storage}/c3549308-0fa3-42f9-9921-a64820f32506-energiekosten-slide-08-capture.webp`,
];
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
          <div style="font-size:23px;line-height:1.45;color:#5f625e;margin-top:20px">Der echte Website-Capture wird pro Lead im Render-Preflight geprüft. Diese QA-Komposition sichert die Master-Timeline und die acht 1280×720 Production-Slides.</div>
        </div>
      </w-el>`;
  }
  return `
    <w-el x="0" y="0" width="1280" height="720" style="overflow:hidden;background:#111">
      <img src="${slides[beat.slide]}" crossorigin="anonymous" alt="${beat.label}" style="position:absolute;inset:0;width:1280px;height:720px;object-fit:cover" />
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
