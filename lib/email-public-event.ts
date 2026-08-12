type PublicEmailEvent = {
  token: string;
  event: "open" | "click" | "unsubscribe";
  url?: string | null;
  userAgent?: string | null;
};

export async function postPublicEmailEvent(payload: PublicEmailEvent, timeoutMs = 2500) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return { ok: false, status: 503 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/functions/v1/email-public-event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 503 };
  } finally {
    clearTimeout(timer);
  }
}
