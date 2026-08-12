import { NextRequest } from "next/server";
import { postPublicEmailEvent } from "@/lib/email-public-event";

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f5f7fa;color:#172033;font-family:Arial,sans-serif"><main style="max-width:620px;margin:80px auto;padding:32px;background:#fff;border:1px solid #e6eaf0;border-radius:16px;box-shadow:0 18px 50px rgba(16,24,40,.08)">${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

export async function GET(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return page("E-Mail abmelden", `<h1 style="font-size:26px;margin:0 0 12px">Keine weiteren E-Mails?</h1><p style="line-height:1.6;color:#667085">Mit einem Klick bestätigen Sie, dass an diese Adresse keine weiteren Walkenhorst-Outbound-E-Mails gesendet werden sollen.</p><form method="post" action="/u/${encodeURIComponent(token)}"><button type="submit" style="margin-top:12px;padding:12px 18px;border:0;border-radius:10px;background:#172033;color:#fff;font-weight:700;cursor:pointer">Abmeldung bestätigen</button></form>`);
}

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await postPublicEmailEvent({ token, event: "unsubscribe", userAgent: req.headers.get("user-agent") });
  if (!result.ok) {
    return page("Abmeldung nicht möglich", `<h1 style="font-size:26px;margin:0 0 12px">Abmeldung konnte nicht bestätigt werden.</h1><p style="line-height:1.6;color:#667085">Der Link ist möglicherweise ungültig oder bereits abgelaufen. Bitte versuchen Sie es später erneut.</p>`, result.status === 404 ? 404 : 503);
  }
  return page("Erfolgreich abgemeldet", `<h1 style="font-size:26px;margin:0 0 12px">Erfolgreich abgemeldet.</h1><p style="line-height:1.6;color:#667085">Für diese Adresse wurde die Kontakt-Sperre gespeichert. Es werden keine weiteren Outbound-E-Mails aus dieser Sequenz versendet.</p>`);
}
