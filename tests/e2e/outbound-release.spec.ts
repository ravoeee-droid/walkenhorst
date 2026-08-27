import { expect, test, type Page, type Route } from "@playwright/test";

const SUPABASE = "https://qa.supabase.invalid";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const PAGE_ID = "33333333-3333-4333-8333-333333333333";

const lead = {
  id: LEAD_ID,
  user_id: USER_ID,
  company_name: "QA Solarwerke GmbH",
  contact_name: "Anna Beispiel",
  contact_title: "Geschäftsführung",
  email: "anna@example.test",
  phone: "+49 711 123456",
  website: "https://example.test",
  city: "Stuttgart",
  postcode: "70173",
  address: "Teststraße 1",
  industry: "Produktion",
  employees: 85,
  location_count: 2,
  roof_area_m2: 1800,
  annual_energy_kwh: 420000,
  pv_present: false,
  status: "ready",
  customer_type: "commercial",
  total_score: 92,
  pv_score: 88,
  energy_score: 91,
  intent_score: 84,
  contactability_score: 96,
  summary: "Hoher Energiebedarf und geeignete Dachfläche.",
  pitch: "Energiekosten systematisch prüfen.",
  next_action: "Persönliche Analyse senden",
  next_action_at: null,
  do_not_contact: false,
  updated_at: "2026-08-27T10:00:00.000Z",
};

const workflowReady = {
  lead_id: LEAD_ID,
  contact_count: 1,
  enrichment_status: "complete",
  page_ready: true,
  video_ready: true,
  email_draft_ready: true,
  email_reviewed: true,
  email_sent: false,
  email_opened: true,
  email_clicked: true,
  page_viewed: true,
  video_played: true,
  max_watch_percent: 82,
  cta_clicked: false,
  replied: false,
  workflow_stage: 6,
  workflow_stage_label: "Prüfung",
  recommended_action: "Versand freigeben",
  workflow_percent: 78,
  video_page_slug: "qa-walkenhorst",
  rendered_video_url: "https://cdn.example.test/final.mp4",
};

const publicVideoPage = {
  id: PAGE_ID,
  company_name: lead.company_name,
  prospect_name: lead.contact_name,
  website_url: lead.website,
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
  landing_config: null,
  brand_kit_snapshot: null,
  rendered_video_url: "https://cdn.example.test/final.mp4",
  rendered_video_format: "mp4",
};

type MockState = {
  workflow?: typeof workflowReady;
  page?: Record<string, unknown> | null;
  draft?: Record<string, unknown> | null;
  gates?: { checks: Array<{ key: string; label: string; ok: boolean }>; allPassed: boolean; sendPassed: boolean };
};

async function installSession(page: Page) {
  await page.addInitScript(({ userId }) => {
    const session = {
      access_token: "qa-access-token",
      refresh_token: "qa-refresh-token",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: {
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "qa@walkenhorst.test",
        app_metadata: { provider: "email", providers: ["email"], workspace_owner_id: userId },
        user_metadata: { full_name: "QA Walkenhorst" },
        identities: [],
        created_at: "2026-08-27T09:00:00.000Z",
        updated_at: "2026-08-27T09:00:00.000Z",
      },
    };
    window.localStorage.setItem("sb-qa-auth-token", JSON.stringify(session));
  }, { userId: USER_ID });
}

function json(route: Route, value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", ...extraHeaders },
    body: JSON.stringify(value),
  });
}

async function mockSupabase(page: Page, state: MockState = {}) {
  const actions: Array<{ endpoint: string; body: any }> = [];
  const flow = state.workflow ?? workflowReady;
  const detailPage = state.page === undefined
    ? { id: PAGE_ID, slug: "qa-walkenhorst", status: "published", is_public: true, rendered_video_url: flow.rendered_video_url, rendered_at: "2026-08-27T10:10:00.000Z", template_key: "energiekosten", duration_seconds: 107, updated_at: "2026-08-27T10:10:00.000Z" }
    : state.page;
  const draft = state.draft === undefined
    ? { id: "draft-1", status: "ready", to_email: lead.email, from_email: "andreas@walkenhorst.test", subject: "Ihre Energieanalyse", body_text: "Persönliche Analyse", created_at: "2026-08-27T10:15:00.000Z", updated_at: "2026-08-27T10:15:00.000Z" }
    : state.draft;
  const gates = state.gates ?? { checks: [], allPassed: true, sendPassed: true };

  await page.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const accept = request.headers()["accept"] || "";
    const single = accept.includes("application/vnd.pgrst.object+json");

    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
    if (path === "/auth/v1/user") return json(route, {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "qa@walkenhorst.test",
      app_metadata: { provider: "email", providers: ["email"], workspace_owner_id: USER_ID },
      user_metadata: { full_name: "QA Walkenhorst" },
      identities: [],
      created_at: "2026-08-27T09:00:00.000Z",
      updated_at: "2026-08-27T09:00:00.000Z",
    });

    if (path.startsWith("/functions/v1/")) {
      const body = request.postDataJSON?.() ?? {};
      actions.push({ endpoint: path.split("/").pop() || "", body });
      if (path.endsWith("/crm-render-queue")) return json(route, { queued: 1, skipped: 0, failed: 0, result: { status: "queued" } });
      if (path.endsWith("/crm-lead-workflow")) {
        if (body.action === "status" || body.action === "preflight") return json(route, { ok: true, workflow: flow, contacts: [{ id: "contact-1", name: lead.contact_name, title: lead.contact_title, email: lead.email, phone: lead.phone, source_url: lead.website, confidence: 99, is_primary: true, source: "qa" }], page: detailPage, draft, gates });
        return json(route, { ok: true, workflow: flow, page: detailPage, draft, gates });
      }
      return json(route, { ok: true });
    }

    if (path.includes("/rest/v1/rpc/")) return json(route, null);
    if (path.endsWith("/rest/v1/energy_leads")) return json(route, single ? lead : [lead], 200, { "content-range": "0-0/1" });
    if (path.endsWith("/rest/v1/energy_crm_lead_workflow")) return json(route, single ? flow : [flow], 200, { "content-range": "0-0/1" });
    if (path.endsWith("/rest/v1/energy_video_pages")) {
      if (url.searchParams.get("slug")?.includes("qa-walkenhorst")) return json(route, publicVideoPage);
      return json(route, single ? detailPage : detailPage ? [detailPage] : []);
    }
    if (path.endsWith("/rest/v1/energy_render_jobs")) {
      if (request.method() === "HEAD") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-range": "0-0/0" } });
      return json(route, single ? null : [], 200, { "content-range": "0-0/0" });
    }
    if (path.endsWith("/rest/v1/energy_followups") || path.endsWith("/rest/v1/energy_activities") || path.endsWith("/rest/v1/energy_messages") || path.endsWith("/rest/v1/energy_lead_contacts")) return json(route, []);
    if (path.includes("/storage/v1/")) return json(route, {});
    if (request.method() === "HEAD") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-range": "0-0/0" } });
    return json(route, single ? null : []);
  });
  await page.route("https://cdn.example.test/**", (route) => route.fulfill({ status: 204, contentType: "video/mp4", body: "" }));
  return actions;
}

test.beforeEach(async ({ page }) => {
  await installSession(page);
});

test("CRM loads with process state and watchtime", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/crm/commercial");
  await expect(page.getByRole("heading", { name: "Gewerbe CRM" })).toBeVisible();
  await expect(page.getByText("QA Solarwerke GmbH", { exact: true })).toBeVisible();
  await expect(page.getByText("Prüfung", { exact: true })).toBeVisible();
  await expect(page.getByText("82%", { exact: true })).toBeVisible();
});

test("lead opens from commercial CRM", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/crm/commercial");
  await page.getByText("QA Solarwerke GmbH", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${LEAD_ID}$`));
  await expect(page.getByText("QA Solarwerke GmbH", { exact: true }).first()).toBeVisible();
});

test("bulk checkbox, enrichment and landingpage actions work", async ({ page }) => {
  const actions = await mockSupabase(page);
  await page.goto("/crm/commercial");
  const boxes = page.getByRole("checkbox");
  await boxes.nth(1).check();
  await expect(page.getByText("1 ausgewählt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enrichment", exact: true }).click();
  await expect.poll(() => actions.some((x) => x.endpoint === "crm-lead-workflow" && x.body.action === "enrich")).toBeTruthy();
  await page.waitForTimeout(1900);
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "LP erstellen", exact: true }).click();
  await expect.poll(() => actions.some((x) => x.endpoint === "crm-lead-workflow" && x.body.action === "prepare_page")).toBeTruthy();
});

test("render bulk queues a job without navigating to Studio", async ({ page }) => {
  const actions = await mockSupabase(page);
  await page.goto("/crm/commercial");
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Videos rendern", exact: true }).click();
  await expect.poll(() => actions.some((x) => x.endpoint === "crm-render-queue" && x.body.action === "bulk_queue" && x.body.leadIds?.includes(LEAD_ID))).toBeTruthy();
  await expect(page).toHaveURL(/\/crm\/commercial$/);
  await expect(page.getByText(/1 Videos eingeplant/)).toBeVisible();
});

test("public landing page uses completed rendered MP4", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/v/qa-walkenhorst");
  await expect(page.getByText("QA Solarwerke GmbH", { exact: true }).first()).toBeVisible();
  const video = page.locator("video").first();
  await expect(video).toHaveAttribute("src", "https://cdn.example.test/final.mp4");
});

test("mail send stays blocked until rendered video exists", async ({ page }) => {
  const blockedWorkflow = { ...workflowReady, video_ready: false, rendered_video_url: null, workflow_stage: 5, workflow_stage_label: "Prüfung", workflow_percent: 66 };
  await mockSupabase(page, {
    workflow: blockedWorkflow,
    page: { id: PAGE_ID, slug: "qa-walkenhorst", status: "published", is_public: true, rendered_video_url: null, rendered_at: null, template_key: "energiekosten", duration_seconds: 107, updated_at: "2026-08-27T10:10:00.000Z" },
    gates: { checks: [{ key: "video", label: "Video fertig gerendert", ok: false }], allPassed: false, sendPassed: false },
  });
  await page.goto(`/leads/${LEAD_ID}`);
  const send = page.getByRole("button", { name: "E-Mail senden", exact: true });
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();
});
