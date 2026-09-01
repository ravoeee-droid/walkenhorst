import { appendFile } from "node:fs/promises";

const EDGE_URL = process.env.RENDER_TICKET_URL || "https://jiahshldcusphxtbqxpv.supabase.co/functions/v1/github-render-ticket";
const AUDIENCE = "walkenhorst-render";

async function oidc() {
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

const token = await oidc();
const response = await fetch(EDGE_URL, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ action: "peek" }),
  signal: AbortSignal.timeout(30_000),
});
const data = await response.json().catch(() => ({}));
if (!response.ok || data?.error) throw new Error(String(data?.error || `Render probe HTTP ${response.status}`));
const hasWork = Boolean(data?.hasWork);
console.log(hasWork ? "Render queue has work." : "Render queue is empty.");
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `has_work=${hasWork ? "true" : "false"}\n`);
