import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@7";
import { ImapFlow } from "npm:imapflow@1";

const headers = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function envKeys() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const publishableSet = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretSet = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publicKey = publishableSet ? JSON.parse(publishableSet)?.default : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretSet ? JSON.parse(secretSet)?.default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publicKey || !secretKey) throw new Error("Backend configuration missing");
  return { url, publicKey, secretKey };
}
async function userFromRequest(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const { url, publicKey } = envKeys();
  const scoped = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await scoped.auth.getUser(token);
  return error || !data.user ? null : data.user;
}
function admin() { const { url, secretKey } = envKeys(); return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }); }
function cleanPort(value: unknown, fallback: number) { const port = Number(value); return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback; }
async function ownedMailbox(db: ReturnType<typeof admin>, id: string, userId: string) { const { data } = await db.from("energy_mailboxes").select("*").eq("id", id).eq("user_id", userId).maybeSingle(); return data; }
async function mailboxSecrets(db: ReturnType<typeof admin>, id: string, userId: string) {
  const { data, error } = await db.rpc("energy_get_mailbox_secrets", { p_mailbox_id: id, p_user_id: userId }); if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data; return { smtp: row?.smtp_password || "", imap: row?.imap_password || row?.smtp_password || "" };
}
async function syncReplies(db: ReturnType<typeof admin>, mailbox: any, userId: string) {
  if (!mailbox.imap_host || !mailbox.imap_username) throw new Error("IMAP-Konfiguration fehlt");
  const secrets = await mailboxSecrets(db, mailbox.id, userId); if (!secrets.imap) throw new Error("IMAP-Passwort fehlt");
  const client = new ImapFlow({ host: mailbox.imap_host, port: cleanPort(mailbox.imap_port, 993), secure: mailbox.imap_secure !== false, auth: { user: mailbox.imap_username, pass: secrets.imap }, logger: false });
  let synced = 0;
  try {
    await client.connect(); const lock = await client.getMailboxLock("INBOX");
    try {
      const since = mailbox.last_sync_at ? new Date(new Date(mailbox.last_sync_at).getTime() - 3600_000) : new Date(Date.now() - 7 * 86400_000);
      const ids = await client.search({ since }); const recent = ids.slice(-200);
      for await (const msg of client.fetch(recent, { envelope: true, uid: true })) {
        const messageId = msg.envelope?.messageId || `imap-${mailbox.id}-${msg.uid}`; const from = msg.envelope?.from?.[0]?.address?.toLowerCase(); if (!from) continue;
        const { data: exists } = await db.from("energy_messages").select("id").eq("user_id", userId).eq("provider_message_id", messageId).maybeSingle(); if (exists) continue;
        const { data: lead } = await db.from("energy_leads").select("id,company_name,status,intent_score").eq("user_id", userId).ilike("email", from).maybeSingle(); if (!lead) continue;
        const { data: outbound } = await db.from("energy_messages").select("id,campaign_id,campaign_member_id").eq("user_id", userId).eq("lead_id", lead.id).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const subject = msg.envelope?.subject || "Antwort";
        await db.from("energy_messages").insert({ user_id: userId, lead_id: lead.id, campaign_id: outbound?.campaign_id || null, campaign_member_id: outbound?.campaign_member_id || null, mailbox_id: mailbox.id, direction: "inbound", status: "replied", from_email: from, to_email: mailbox.email_address, subject, provider_message_id: messageId, replied_at: new Date().toISOString(), sent_at: msg.envelope?.date?.toISOString() || new Date().toISOString(), metadata: { imap_uid: msg.uid } });
        if (outbound?.id) await db.from("energy_messages").update({ status: "replied", replied_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", outbound.id);
        if (outbound?.campaign_member_id) await db.from("energy_campaign_members").update({ status: "stopped", stopped_reason: "reply", reply_status: "replied", updated_at: new Date().toISOString() }).eq("id", outbound.campaign_member_id);
        await db.from("energy_leads").update({ status: "engaged", last_replied_at: new Date().toISOString(), intent_score: Math.min(100, Number(lead.intent_score || 0) + 30), updated_at: new Date().toISOString() }).eq("id", lead.id).eq("user_id", userId);
        await db.from("energy_followups").insert({ user_id: userId, lead_id: lead.id, campaign_id: outbound?.campaign_id || null, title: `${lead.company_name} hat geantwortet`, due_at: new Date().toISOString(), priority: "hot", reason: subject });
        await db.from("energy_activities").insert({ user_id: userId, lead_id: lead.id, campaign_id: outbound?.campaign_id || null, activity_type: "email_reply", title: "E-Mail-Antwort erkannt", detail: subject }); synced++;
      }
    } finally { lock.release(); }
    await db.from("energy_mailboxes").update({ last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", mailbox.id).eq("user_id", userId);
  } finally { await client.logout().catch(() => undefined); }
  return synced;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const user = await userFromRequest(req); if (!user) return reply({ error: "Nicht autorisiert" }, 401); const body = await req.json(); const action = String(body?.action || ""); const db = admin();
    if (action === "save") {
      const email = String(body?.emailAddress || "").trim().toLowerCase(); if (!email || !email.includes("@")) return reply({ error: "Gültige E-Mail-Adresse erforderlich" }, 400);
      const values = { user_id: user.id, email_address: email, from_name: String(body?.fromName || "").trim() || null, provider: String(body?.provider || "smtp").trim() || "smtp", daily_limit: Math.max(1, Math.min(50, Number(body?.dailyLimit) || 30)), smtp_host: String(body?.smtpHost || "").trim() || null, smtp_port: cleanPort(body?.smtpPort, 587), smtp_secure: Boolean(body?.smtpSecure), smtp_username: String(body?.smtpUsername || email).trim(), imap_host: String(body?.imapHost || "").trim() || null, imap_port: cleanPort(body?.imapPort, 993), imap_secure: body?.imapSecure !== false, imap_username: String(body?.imapUsername || email).trim(), reply_to: String(body?.replyTo || "").trim() || null, status: "setup", updated_at: new Date().toISOString() };
      let mailbox: any;
      if (body?.id) { const existing = await ownedMailbox(db, String(body.id), user.id); if (!existing) return reply({ error: "Mailbox nicht gefunden" }, 404); const { data, error } = await db.from("energy_mailboxes").update(values).eq("id", body.id).eq("user_id", user.id).select("*").single(); if (error) throw error; mailbox = data; }
      else { const { data, error } = await db.from("energy_mailboxes").insert(values).select("*").single(); if (error) throw error; mailbox = data; }
      const smtpPassword = String(body?.smtpPassword || ""); const imapPassword = String(body?.imapPassword || "");
      if (smtpPassword || imapPassword) { const { error } = await db.rpc("energy_store_mailbox_secrets", { p_mailbox_id: mailbox.id, p_user_id: user.id, p_smtp_password: smtpPassword || null, p_imap_password: imapPassword || null }); if (error) throw error; }
      const { smtp_secret_id: _s, imap_secret_id: _i, ...safe } = mailbox; return reply({ ok: true, mailbox: safe });
    }
    const id = String(body?.id || ""); const mailbox = id ? await ownedMailbox(db, id, user.id) : null; if (!mailbox) return reply({ error: "Mailbox nicht gefunden" }, 404);
    if (action === "test") {
      const secrets = await mailboxSecrets(db, mailbox.id, user.id); if (!mailbox.smtp_host || !mailbox.smtp_username || !secrets.smtp) return reply({ error: "SMTP-Konfiguration oder Passwort fehlt" }, 400);
      try { const transport = nodemailer.createTransport({ host: mailbox.smtp_host, port: cleanPort(mailbox.smtp_port, 587), secure: Boolean(mailbox.smtp_secure), auth: { user: mailbox.smtp_username, pass: secrets.smtp }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 }); await transport.verify(); await db.from("energy_mailboxes").update({ status: "ready", last_tested_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", mailbox.id).eq("user_id", user.id); return reply({ ok: true, message: "SMTP-Verbindung erfolgreich" }); }
      catch (error) { const message = error instanceof Error ? error.message.slice(0, 500) : "SMTP-Test fehlgeschlagen"; await db.from("energy_mailboxes").update({ status: "error", last_tested_at: new Date().toISOString(), last_error: message, updated_at: new Date().toISOString() }).eq("id", mailbox.id).eq("user_id", user.id); return reply({ ok: false, error: message }, 422); }
    }
    if (action === "sync") {
      try { const count = await syncReplies(db, mailbox, user.id); return reply({ ok: true, synced: count }); }
      catch (error) { const message = error instanceof Error ? error.message.slice(0, 500) : "IMAP-Sync fehlgeschlagen"; await db.from("energy_mailboxes").update({ last_error: message, updated_at: new Date().toISOString() }).eq("id", mailbox.id).eq("user_id", user.id); return reply({ ok: false, error: message }, 422); }
    }
    return reply({ error: "Unbekannte Aktion" }, 400);
  } catch (error) { return reply({ error: error instanceof Error ? error.message.slice(0, 500) : "Interner Fehler" }, 500); }
});
