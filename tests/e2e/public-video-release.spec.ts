import { expect, test, type Route } from "@playwright/test";

const SUPABASE = "https://qa.supabase.invalid";

function json(route: Route, value: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
    },
    body: JSON.stringify(value),
  });
}

test("public landing page uses completed rendered MP4", async ({ page }) => {
  const publicVideoPage = {
    id: "33333333-3333-4333-8333-333333333333",
    company_name: "QA Solarwerke GmbH",
    prospect_name: "Anna Beispiel",
    website_url: "https://example.test",
    presenter_video_url: null,
    website_capture_url: null,
    headline: "Persönliche Energieanalyse",
    intro_text: "Drei konkrete Hebel für Ihre Energiekosten.",
    bullets: ["Lastprofil prüfen", "Beschaffung optimieren", "Eigenverbrauch bewerten"],
    cta_label: "Potenzialcheck anfragen",
    cta_url: "https://example.test/kontakt",
    duration_seconds: 107,
    status: "published",
    studio_config: {},
    accent_color: "#d9a928",
    template_key: "energiekosten",
    timeline_v3: null,
    landing_config: {
      version: 3,
      theme: "walkenhorst",
      showLogo: false,
      stickyCta: false,
      blocks: [
        {
          id: "qa-hero",
          type: "hero",
          enabled: true,
          order: 10,
          headline: "Persönliche Energieanalyse für {{company}}",
          body: "Ihre individuelle Analyse.",
          style: { background: "brand.background", paddingY: 24, maxWidth: 1100, radius: 0, align: "left" },
        },
        {
          id: "qa-video",
          type: "video",
          enabled: true,
          order: 20,
          headline: "Ihre persönliche Videoanalyse",
          style: { background: "brand.background", paddingY: 18, maxWidth: 1100, radius: 18, align: "center" },
        },
      ],
    },
    brand_kit_snapshot: null,
    rendered_video_url: "https://cdn.example.test/final.mp4",
    rendered_video_format: "mp4",
  };

  await page.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS,HEAD",
          "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile",
        },
      });
    }
    const url = new URL(request.url());
    if (url.pathname.endsWith("/rest/v1/energy_video_pages")) return json(route, publicVideoPage);
    if (url.pathname.endsWith("/rest/v1/energy_video_events")) return json(route, []);
    return json(route, []);
  });
  await page.route("https://cdn.example.test/**", (route) => route.fulfill({ status: 204, contentType: "video/mp4", body: "" }));

  await page.goto("/v/qa-walkenhorst");
  await expect(page.getByRole("heading", { name: "Persönliche Energieanalyse für QA Solarwerke GmbH" })).toBeVisible();
  await expect(page.locator("video").first()).toHaveAttribute("src", "https://cdn.example.test/final.mp4");
});
