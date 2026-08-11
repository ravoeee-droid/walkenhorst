"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function AuthGate({ children }: { children: (user: User) => React.ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    void supabase.auth.getUser().then(({ data }) => { setUser(data.user ?? null); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setLoading(true); setError(null);
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) setError(result.error.message);
    else if (result.data.user) setUser(result.data.user);
  }

  if (!supabase) {
    return <main className="shell"><section className="card hero"><div className="eyebrow">Setup erforderlich</div><h1>Walkenhorst Energy Sales Radar</h1><p className="muted">GitHub und Vercel sind verbunden. Für Login, CRM und Tracking fehlen noch <code>NEXT_PUBLIC_SUPABASE_URL</code> und <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> des eigenen Walkenhorst-Supabase-Projekts.</p></section></main>;
  }
  if (loading) return <main className="shell"><section className="card">System wird geladen …</section></main>;
  if (user) return <>{children(user)}</>;

  return <main className="shell" style={{maxWidth:720}}><section className="card hero">
    <div className="eyebrow">Walkenhorst · Energy Sales Intelligence</div>
    <h1>Ein System für Research, Outreach und Termine.</h1>
    <p className="muted">Leads finden, Energiepotenzial bewerten, personalisierte Video-Analysen erzeugen und den kompletten Sales-Prozess verfolgen.</p>
    <form className="form" onSubmit={submit}>
      <div className="field"><label>E-Mail</label><input name="email" type="email" required autoComplete="email" /></div>
      <div className="field"><label>Passwort</label><input name="password" type="password" required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} /></div>
      {error && <div className="error">{error}</div>}
      <button className="button primary" type="submit">{mode === "signin" ? "Anmelden" : "Account erstellen"}</button>
      <button className="button" type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Ersten Account erstellen" : "Zur Anmeldung"}</button>
    </form>
  </section></main>;
}
