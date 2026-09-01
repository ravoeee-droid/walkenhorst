import { chromium } from "playwright";

const EDGE_URL = process.env.RENDER_TICKET_URL || "https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/github-render-ticket";
const APP_URL = (process.env.WALKENHORST_APP_URL || "https://walkenhorst.vercel.app").replace(/\/$/, "");
const AUDIENCE = "walkenhorst-render";
const MAX_JOBS = Math.max(1, Math.min(6, Number(process.env.MAX_JOBS_PER_RUN || 3)));
const JOB_TIMEOUT_MS = Math.max(240_000, Number(process.env.RENDER_JOB_TIMEOUT_MS || 900_000));
const WORKER = `gha-${process.env.GITHUB_RUN_ID || "local"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}-${process.env.WORKER_SLOT || "1"}`;

async function githubOidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error("GitHub OIDC environment is unavailable.");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", AUDIENCE);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.value) throw new Error(`GitHub OIDC token request failed (${response.status}).`);
  return String(data.value);
}

async function ticket(action, payload = {}) {
  const oidc = await githubOidcToken();
  const response = await fetch(EDGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${oidc}`,
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(String(data?.error || `Render ticket HTTP ${response.status}`));
  return data;
}

async function reportRunnerFailure(jobId, error) {
  const message = error instanceof Error ? error.message : String(error || "GitHub render worker failed");
  try {
    const result = await ticket("runner_fail", { jobId, error: message.slice(0, 700) });
    console.error(`[${jobId}] worker failure -> ${result.status}`, message);
    return result;
  } catch (reportError) {
    console.error(`[${jobId}] could not report worker failure`, reportError);
    return null;
  }
}

async function renderJob(browser, claim) {
  const jobId = String(claim.jobId || "");
  const token = String(claim.token || "");
  if (!jobId || !token) throw new Error("Claim returned no render token.");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /render|mp4|asset|capture/i.test(text)) {
      console.log(`[${jobId}] browser:${message.type()} ${text}`);
    }
  });
  page.on("pageerror", (error) => console.error(`[${jobId}] pageerror`, error.message));

  try {
    const renderUrl = `${APP_URL}/v/internal-render/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`;
    const response = await page.goto(renderUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (!response || response.status() >= 400) throw new Error(`Render page returned HTTP ${response?.status() || "unknown"}.`);

    await page.waitForFunction(
      () => ["completed", "failed"].includes(document.documentElement.dataset.renderStatus || ""),
      undefined,
      { timeout: JOB_TIMEOUT_MS, polling: 1000 },
    );
    const state = await page.evaluate(() => ({
      status: document.documentElement.dataset.renderStatus || "",
      error: document.documentElement.dataset.renderError || "",
    }));
    if (state.status !== "completed") throw new Error(state.error || "Browser render reported failed status.");
    console.log(`[${jobId}] completed`);
    return true;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function main() {
  console.log(`Walkenhorst render worker ${WORKER} · max ${MAX_JOBS} jobs`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });

  let completed = 0;
  let handled = 0;
  try {
    for (let i = 0; i < MAX_JOBS; i += 1) {
      const claim = await ticket("claim", { worker: WORKER });
      if (claim.status === "empty") {
        console.log("Queue empty.");
        break;
      }
      if (claim.status === "retrying" || claim.status === "failed") {
        handled += 1;
        console.log(`[${claim.jobId}] preflight ${claim.status}: ${claim.reason || "validation/capture error"}`);
        continue;
      }
      if (claim.status !== "claimed") throw new Error(`Unexpected claim state: ${claim.status || "unknown"}`);

      handled += 1;
      console.log(`[${claim.jobId}] claimed · attempt ${claim.attempt}/${claim.maxAttempts}`);
      try {
        await renderJob(browser, claim);
        completed += 1;
      } catch (error) {
        await reportRunnerFailure(claim.jobId, error);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log(`Worker finished · handled ${handled} · completed ${completed}`);
}

main().catch((error) => {
  console.error("Fatal worker error", error);
  process.exitCode = 1;
});
