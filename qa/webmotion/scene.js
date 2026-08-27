const fps = 30;
const storage = "https://jiahshldcusphxtbqxpv.supabase.co/storage/v1/object/public/energy-media/1b6c9d54-48c7-4bda-bac0-5ede3c71e197/template-slides";
const slides = [
  `${storage}/70c35ad9-2b6f-4009-b606-e6040e1b159d-energiekosten-clean-01.png`,
  `${storage}/f4378915-6896-4fec-a01d-83ee7213f5b5-energiekosten-clean-02.png`,
  `${storage}/6570da32-d578-4d10-895c-a98ef74d2a2b-energiekosten-clean-03.png`,
  `${storage}/4b5b0592-f7df-4e8d-bb0f-68a4ad3e6b36-energiekosten-clean-04.png`,
  `${storage}/6be6f532-278a-4096-9c7b-586421222e85-energiekosten-clean-05.png`,
  `${storage}/81dc95b4-5f15-4bd4-bf6f-3b336494a1b4-energiekosten-clean-06.png`,
  `${storage}/436da12b-d3ee-48d4-91b5-801b33a5b427-energiekosten-clean-07.png`,
  `${storage}/36b2ce21-414d-4014-9519-e3e7cac0ccd5-energiekosten-clean-08.png`,
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
          <div style="font-size:23px;line-height:1.45;color:#5f625e;margin-top:20px">Der echte Website-Capture wird pro Lead im Render-Preflight geprüft. Diese QA-Komposition sichert die Master-Timeline und die acht echten Clean-Slides.</div>
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
