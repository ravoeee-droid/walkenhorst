"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function AuthGate({ children }: { children: (user: User) => React.ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [lastEmail, setLastEmail] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

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
        setError(
          result.error.message.toLowerCase().includes("email not confirmed")
            ? "Deine E-Mail ist noch nicht bestätigt. Bitte bestätige den Link aus der Supabase-Mail oder sende unten eine neue Bestätigung."
            : result.error.message,
        );
        return;
      }
      if (!result.data.session) {
        setError("Es wurde keine gültige Login-Session erstellt. Bitte erneut anmelden.");
        return;
      }
      setUser(result.data.session.user);
      return;
    }

    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
      },
    });
    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (result.data.session) {
      setUser(result.data.session.user);
      return;
    }

    setMode("signin");
    setNotice("Account angelegt. Bitte bestätige jetzt die E-Mail. Erst danach wird eine echte Session erstellt und RLS erlaubt CRM-Zugriffe.");
  }

  async function resendConfirmation() {
    if (!supabase || !lastEmail) {
      setError("Bitte zuerst deine E-Mail-Adresse im Formular eingeben.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: lastEmail,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
      },
    });
    setLoading(false);
    if (resendError) setError(resendError.message);
    else setNotice("Bestätigungs-E-Mail wurde erneut gesendet.");
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
            <button className="auth-link" type="button" onClick={() => void resendConfirmation()}>
              Bestätigungs-E-Mail erneut senden
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
