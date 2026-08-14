"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function getAppUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL;
  let url = configuredUrl ?? (typeof window !== "undefined" ? window.location.origin : "");

  if (!url) return undefined;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  return url.replace(/\/$/, "");
}

function getAuthRedirectUrl() {
  const appUrl = getAppUrl();
  return appUrl ? `${appUrl}/dashboard` : undefined;
}

function isLocalUrl(url?: string) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function readableAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("email rate limit exceeded") || normalized.includes("over_email_send_rate_limit")) {
    return "Das Supabase-Mail-Limit ist gerade erreicht. Bitte nicht mehrfach klicken. Warte bis das Limit zurückgesetzt ist und sende dann genau eine neue Bestätigungs-E-Mail.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Deine E-Mail ist noch nicht bestätigt. Bitte bestätige den neuesten Link aus der Supabase-Mail oder sende unten eine neue Bestätigung.";
  }
  return message;
}

function asWorkspaceUser(user: User | null | undefined): User | null {
  if (!user) return null;
  const owner = typeof user.app_metadata?.workspace_owner_id === "string"
    ? user.app_metadata.workspace_owner_id.trim()
    : "";
  if (!owner || owner === user.id) return user;
  return {
    ...user,
    id: owner,
    app_metadata: {
      ...user.app_metadata,
      login_user_id: user.id,
    },
  } as User;
}

export function AuthGate({ children }: { children: (user: User) => React.ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [lastEmail, setLastEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (typeof window !== "undefined" && window.location.hash) {
      const authParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = authParams.get("error_description");
      const authErrorCode = authParams.get("error_code");

      if (authErrorCode === "otp_expired") {
        setError("Der Bestätigungslink ist abgelaufen oder wurde bereits verwendet. Bitte verwende nur den neuesten Link oder sende eine neue Bestätigungs-E-Mail.");
      } else if (authError) {
        setError(readableAuthError(authError.replace(/\+/g, " ")));
      }

      if (authErrorCode || authError) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
    }

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (userError) setUser(null);
      else setUser(asWorkspaceUser(data.user));
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(asWorkspaceUser(session?.user));
      setLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    setLastEmail(email);
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === "signin") {
      const result = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (result.error) {
        setError(readableAuthError(result.error.message));
        return;
      }
      if (!result.data.session) {
        setError("Es wurde keine gültige Login-Session erstellt. Bitte erneut anmelden.");
        return;
      }
      setUser(asWorkspaceUser(result.data.session.user));
      return;
    }

    const redirectUrl = getAuthRedirectUrl();
    if (typeof window !== "undefined" && isLocalUrl(window.location.origin) && isLocalUrl(redirectUrl)) {
      setLoading(false);
      setError("Account-Erstellung über localhost ist deaktiviert, damit Supabase keine falschen Bestätigungslinks mehr verschickt. Bitte erstelle neue Accounts in der produktiven Walkenhorst-Version auf Vercel.");
      return;
    }

    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    setLoading(false);

    if (result.error) {
      setError(readableAuthError(result.error.message));
      return;
    }

    if (result.data.session) {
      setUser(asWorkspaceUser(result.data.session.user));
      return;
    }

    setMode("signin");
    setNotice("Account angelegt. Bitte bestätige jetzt die neueste E-Mail. Danach wirst du direkt zurück ins Walkenhorst Radar geleitet.");
  }

  async function resendConfirmation() {
    if (!supabase || !lastEmail) {
      setError("Bitte zuerst deine E-Mail-Adresse im Formular eingeben.");
      return;
    }
    if (resendCooldown > 0) return;

    const redirectUrl = getAuthRedirectUrl();
    if (typeof window !== "undefined" && isLocalUrl(window.location.origin) && isLocalUrl(redirectUrl)) {
      setError("Von localhost werden keine Bestätigungs-Mails mehr verschickt. Öffne dafür die produktive Walkenhorst-Version auf Vercel.");
      return;
    }

    setResendCooldown(60);
    setLoading(true);
    setError(null);
    setNotice(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: lastEmail,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    setLoading(false);
    if (resendError) setError(readableAuthError(resendError.message));
    else setNotice("Neue Bestätigungs-E-Mail wurde gesendet. Bitte verwende ausschließlich den neuesten Link.");
  }

  if (!supabase) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-brand">WH</div>
          <div className="auth-kicker">Setup erforderlich</div>
          <h1>Walkenhorst Energy Sales Radar</h1>
          <p>Supabase ist noch nicht verbunden.</p>
        </section>
      </main>
    );
  }

  if (loading) {
    return <main className="auth-screen"><section className="auth-card">System wird geladen …</section></main>;
  }

  if (user) return <>{children(user)}</>;

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">WH</div>
        <div className="auth-kicker">Walkenhorst · Energy Sales Intelligence</div>
        <h1>{mode === "signin" ? "Willkommen zurück." : "Admin-Account erstellen."}</h1>
        <p>Energy Radar, personalisierte Video-Analysen, Kampagnen und CRM in einem System.</p>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>E-Mail</span>
            <input name="email" type="email" required autoComplete="email" onChange={(event) => setLastEmail(event.target.value.trim().toLowerCase())} />
          </label>
          <label>
            <span>Passwort</span>
            <input name="password" type="password" required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-notice">{notice}</div>}
          <button className="auth-primary" type="submit">{mode === "signin" ? "Anmelden" : "Account erstellen"}</button>
          <button className="auth-secondary" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setNotice(null); }}>
            {mode === "signin" ? "Ersten Account erstellen" : "Zur Anmeldung"}
          </button>
          {mode === "signin" && (
            <button className="auth-link" type="button" disabled={resendCooldown > 0} onClick={() => void resendConfirmation()}>
              {resendCooldown > 0 ? `Erneut senden (${resendCooldown}s)` : "Bestätigungs-E-Mail erneut senden"}
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
