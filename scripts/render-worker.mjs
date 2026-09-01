import { chromium } from "playwright";
import dns from "node:dns/promises";
import net from "node:net";

const EDGE_URL = process.env.RENDER_TICKET_URL || "https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/github-render-ticket";
const APP_URL = (process.env.WALKENHORST_APP_URL || "https://walkenhorst.vercel.app").replace(/\/$/, "");
const AUDIENCE = "walkenhorst-render";
const MAX_JOBS = Math.max(1, Math.min(6, Number(process.env.MAX_JOBS_PER_RUN || 3)));
const JOB_TIMEOUT_MS = Math.max(240_000, Number(process.env.RENDER_JOB_TIMEOUT_MS || 900_000));
const WORKER = `gha-${process.env.GITHUB_RUN_ID || "local"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}-${process.env.WORKER_SLOT || "1"}`;
const CAPTURE_WIDTH = 1920;
const CAPTURE_HEIGHT = 1080;

async function githubOidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error("GitHub OIDC environment is unavailable.");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", AUDIENCE);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${requestToken}` }, signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.value) throw new Error(`GitHub OIDC token request failed (${response.status}).`);
  return String(data.value);
}

async function ticket(action, payload = {}) {
  const oidc = await githubOidcToken();
  const response = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${oidc}` },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(String(data?.error || `Render ticket HTTP ${response.status}`));
  return data;
}

function privateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateIpv6(ip) {
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

async function safeWebsiteUrl(raw) {
  const url = new URL(String(raw || ""));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Website URL verwendet ein nicht erlaubtes Protokoll.");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Private oder lokale Netzwerkadresse ist nicht erlaubt.");
  if (net.isIP(host)) {
    if ((net.isIPv4(host) && privateIpv4(host)) || (net.isIPv6(host) && privateIpv6(host))) throw new Error("Private oder lokale Netzwerkadresse ist nicht erlaubt.");
  } else {
    const answers = await dns.lookup(host, { all: true, verbatim: true });
    if (!answers.length) throw new Error("Website-Domain konnte nicht aufgelöst werden.");
    for (const answer of answers) {
      if ((answer.family === 4 && privateIpv4(answer.address)) || (answer.family === 6 && privateIpv6(answer.address))) throw new Error("Website-Domain zeigt auf eine private Netzwerkadresse.");
    }
  }
  return url.toString();
}

async function uploadCapture(jobId, bytes, width = CAPTURE_WIDTH, height = CAPTURE_HEIGHT) {
  const oidc = await githubOidcToken();
  const url = new URL(EDGE_URL);
  url.searchParams.set("action", "upload_capture");
  url.searchParams.set("jobId", jobId);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidc}`,
      "content-type": "image/webp",
      "x-capture-width": String(width),
      "x-capture-height": String(height),
    },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(String(data?.error || `Capture upload HTTP ${response.status}`));
  return data;
}

async function freezeLegacyCapture(claim) {
  const capture = claim?.capture || {};
  const url = String(capture.captureUrl || "");
  const width = Number(capture.width || 0);
  const height = Number(capture.height || 0);
  if (!url || width < 1920 || height < 1080 || url.includes("/storage/v1/object/public/")) return null;
  try {
    const response = await fetch(url, { headers: { accept: "image/webp,image/*" }, signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`Legacy-Capture HTTP ${response.status}`);
    const type = String(response.headers.get("content-type") || "");
    if (!type.startsWith("image/")) throw new Error(`Legacy-Capture hat falschen Content-Type: ${type || "unbekannt"}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 30_000) throw new Error(`Legacy-Capture ist verdächtig klein (${bytes.byteLength} Bytes)`);
    const stored = await uploadCapture(String(claim.jobId), bytes, width, height);
    console.log(`[${claim.jobId}] legacy HD capture frozen · ${stored.width}x${stored.height} · ${stored.bytes} bytes`);
    return stored.captureUrl;
  } catch (error) {
    console.log(`[${claim.jobId}] legacy capture freeze skipped: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function materializeCapture(browser, claim) {
  if (claim?.capture?.ready) {
    console.log(`[${claim.jobId}] static HD capture already verified`);
    return claim.capture.captureUrl;
  }

  const frozen = await freezeLegacyCapture(claim);
  if (frozen) return frozen;

  const websiteUrl = await safeWebsiteUrl(claim?.capture?.websiteUrl);
  const context = await browser.newContext({
    viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
    deviceScaleFactor: 1,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    locale: "de-DE",
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  try {
    await page.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      try {
        const parsed = new URL(requestUrl);
        if (!["http:", "https:", "data:", "blob:"].includes(parsed.protocol)) return route.abort();
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || (net.isIPv4(host) && privateIpv4(host)) || (net.isIPv6(host) && privateIpv6(host))) return route.abort();
      } catch {
        return route.abort();
      }
      return route.continue();
    });
    const response = await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!response) throw new Error("Website antwortet nicht.");
    if (response.status() >= 400) throw new Error(`Website antwortet mit HTTP ${response.status()}.`);
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const el of document.querySelectorAll("[style*='position: fixed'], [style*='position:fixed']")) {
        const text = (el.textContent || "").toLowerCase();
        if (/cookie|consent|datenschutz|privacy/.test(text)) el.remove();
      }
    }).catch(() => undefined);
    const bytes = await page.screenshot({ type: "webp", quality: 92, fullPage: false, animations: "disabled" });
    if (bytes.byteLength < 30_000) throw new Error(`HD-Capture ist verdächtig klein (${bytes.byteLength} Bytes).`);
    const stored = await uploadCapture(String(claim.jobId), bytes, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    console.log(`[${claim.jobId}] static HD capture stored · ${stored.width}x${stored.height} · ${stored.bytes} bytes`);
    return stored.captureUrl;
  } finally {
    await context.close().catch(() => undefined);
  }
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
  await materializeCapture(browser, claim);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /render|mp4|asset|capture/i.test(text)) console.log(`[${jobId}] browser:${message.type()} ${text}`);
  });
  page.on("pageerror", (error) => console.error(`[${jobId}] pageerror`, error.message));
  try {
    const renderUrl = `${APP_URL}/v/internal-render/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`;
    const response = await page.goto(renderUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (!response || response.status() >= 400) throw new Error(`Render page returned HTTP ${response?.status() || "unknown"}.`);
    await page.waitForFunction(() => ["completed", "failed"].includes(document.documentElement.dataset.renderStatus || ""), undefined, { timeout: JOB_TIMEOUT_MS, polling: 1000 });
    const state = await page.evaluate(() => ({ status: document.documentElement.dataset.renderStatus || "", error: document.documentElement.dataset.renderError || "" }));
    if (state.status !== "completed") throw new Error(state.error || "Browser render reported failed status.");
    console.log(`[${jobId}] completed`);
    return true;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function main() {
  console.log(`Walkenhorst render worker ${WORKER} · max ${MAX_JOBS} jobs`);
  const probe = await ticket("peek", { worker: WORKER });
  if (!probe?.hasWork) {
    console.log("Queue empty. Chromium not started.");
    return;
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  let completed = 0;
  let handled = 0;
  try {
    for (let i = 0; i < MAX_JOBS; i += 1) {
      const claim = await ticket("claim", { worker: WORKER });
      if (claim.status === "empty") { console.log("Queue empty."); break; }
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
