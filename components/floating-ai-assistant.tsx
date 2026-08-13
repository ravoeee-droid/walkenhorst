"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./floating-ai-assistant.module.css";

type Message = { id: string; role: "user" | "assistant"; content: string };
type AssistantAction =
  | { type: "navigate"; path: string }
  | { type: "studio"; action: "select_lead" | "master" | "save" | "publish" | "mode"; leadId?: string; mode?: "video" | "landing" | "brand" | "versions" | "render" }
  | { type: "data_changed"; table: string; id?: string };

const QUICK_PROMPTS = [
  "Was soll ich heute als Nächstes tun?",
  "Zeig mir die heißesten Leads.",
  "Öffne das Studio.",
  "Welche Kampagne braucht Aufmerksamkeit?",
];

function newMessage(role: Message["role"], content: string): Message {
  return { id: crypto.randomUUID(), role, content };
}

export function FloatingAiAssistant({ user }: { user: User }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    newMessage("assistant", "Hi! Ich bin dein Walkenhorst KI-Assistent. Frag mich, was gerade wichtig ist – oder sag mir direkt, was ich im Sales OS ändern soll."),
  ]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function runClientActions(actions: AssistantAction[]) {
    for (const action of actions) {
      if (action.type === "navigate") {
        window.location.assign(action.path);
        return;
      }
      if (action.type === "studio") {
        if (pathname !== "/studio") {
          window.localStorage.setItem("walkenhorst.assistant.studioAction", JSON.stringify(action));
          window.location.assign("/studio");
          return;
        }
        window.dispatchEvent(new CustomEvent("walkenhorst:assistant-studio", { detail: action }));
      }
      if (action.type === "data_changed") {
        window.dispatchEvent(new CustomEvent("walkenhorst:data-changed", { detail: action }));
      }
    }
  }

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy || !supabase) return;
    const userMessage = newMessage("user", prompt);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Deine Sitzung ist abgelaufen. Bitte neu anmelden.");
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          message: prompt,
          path: typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname,
          history: nextMessages.slice(-10).map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Der KI-Assistent konnte die Anfrage nicht ausführen.");
      setMessages((current) => [...current, newMessage("assistant", data.message || "Erledigt.")]);
      if (Array.isArray(data.actions)) window.setTimeout(() => runClientActions(data.actions as AssistantAction[]), 120);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der KI-Assistent ist gerade nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <div className={styles.root}>
      {open ? (
        <section className={styles.panel} aria-label="Walkenhorst KI-Assistent">
          <header className={styles.header}>
            <div className={styles.avatar}>W</div>
            <div className={styles.heading}>
              <strong>Walkenhorst KI</strong>
              <span><i /> Zugriff auf dein Sales OS</span>
            </div>
            <button className={styles.close} type="button" onClick={() => setOpen(false)} aria-label="KI-Assistent schließen">×</button>
          </header>

          <div className={styles.contextBar}>
            <span>Aktuell</span>
            <strong>{pathname === "/studio" ? "Studio V3" : pathname.replace(/^\//, "") || "Dashboard"}</strong>
            <kbd>⌘K</kbd>
          </div>

          <div className={styles.messages}>
            {messages.map((message) => (
              <div className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`} key={message.id}>
                {message.role === "assistant" ? <span className={styles.miniAvatar}>W</span> : null}
                <div>{message.content.split("\n").map((line, index) => <p key={`${message.id}-${index}`}>{line || "\u00a0"}</p>)}</div>
              </div>
            ))}
            {busy ? <div className={`${styles.message} ${styles.assistant}`}><span className={styles.miniAvatar}>W</span><div className={styles.typing}><b /><b /><b /></div></div> : null}
            {error ? <div className={styles.error}>{error}</div> : null}
            <div ref={endRef} />
          </div>

          {messages.length <= 2 ? (
            <div className={styles.quickGrid}>
              {QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)} disabled={busy}>{prompt}</button>)}
            </div>
          ) : null}

          <form className={styles.composer} onSubmit={submit}>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Frag etwas oder gib mir eine Aufgabe …" rows={2} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (input.trim()) void send(input);
              }
            }} />
            <button type="submit" disabled={busy || !input.trim()} aria-label="An KI senden">↑</button>
          </form>
          <footer className={styles.footer}><span>{user.email}</span><span>Änderungen laufen über sichere Aktionen</span></footer>
        </section>
      ) : null}

      <button className={`${styles.fab} ${open ? styles.fabHidden : ""}`} type="button" onClick={() => setOpen(true)} aria-label="Walkenhorst KI-Assistent öffnen">
        <span className={styles.spark}>✦</span>
        <span className={styles.fabText}><strong>KI</strong><small>Frag mich</small></span>
        <span className={styles.liveDot} />
      </button>
    </div>
  );
}
