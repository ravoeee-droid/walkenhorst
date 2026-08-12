# Walkenhorst Energy Sales Radar

Produktionsnahes Revenue-Intelligence-, CRM- und Outbound-System für Walkenhorst. Das Projekt ist eigenständig und von anderen Kundenprojekten getrennt.

## Kernflow

`Lead → Research → PV/Energie-Potenzial → Opportunity Priority → Sales Brief → Call/E-Mail/Video → Intent → Termin → Angebot → Deal`

## Enthalten

- Energy Lead Radar mit PV-, Energie-, Intent- und Contactability-Scoring
- Sales Priority V2 mit echten Intent-/PV-Signalen
- evidence-basierter Sales Brief mit Opener, Fragen und Next Best Action
- CRM, Pipeline, Stage History, Forecast und Revenue Analytics
- Caller Queue mit Rinkel-Call-Historie, AI Insights, Recording und Call Outcomes
- Rinkel Webhook + Reconciliation
- personalisierte Video-Landingpages `/v/<slug>`
- View-, Watch-%, CTA- und Qualification-Tracking
- Native Proposal Tracking mit Hot-Reopen-Signalen
- 5+ Mailbox-fähige Outbound Engine mit Limits und Ramping
- Sequenzen, A/B Varianten, Reply Stop, Inbox Sync
- Open/Click/Unsubscribe Tracking
- RFC One-Click-Unsubscribe Header
- Bounce Detection und Deliverability Center
- persistente Suppression gegen Re-Imports
- Duplicate Detection + kontrollierter Safe Merge
- Revival Engine für liegengebliebene Chancen
- SLA Alert Engine für Hot Leads und Betriebsfehler
- PV Site Intelligence über öffentliche PVGIS-Daten
- CSV Import/Export
- System Health + Go-Live Center
- Integrationen für Rinkel, Firecrawl, Reacher, Google Maps, Chatwoot und Activepieces
- Supabase RLS, Vault-Secrets und Worker-Key-Schutz

## Wichtige Routen

- `/command` Daily Command Center
- `/opportunities` Sales Priority
- `/sales-brief` Sales Brief
- `/calls` Caller Queue
- `/meetings` Meeting Prep
- `/pipeline` Pipeline
- `/analytics` Revenue Analytics
- `/campaign-lab` Kampagnen/A-B Tests
- `/proposals` Angebote
- `/pv-intelligence` PV Site Intelligence
- `/alerts` SLA Alerts
- `/deliverability` Deliverability
- `/suppression` Suppression Registry
- `/data-hygiene` Dubletten
- `/revival` Revival
- `/data` CSV Import/Export
- `/integrations` Provider & Mailboxen
- `/settings` Produktions-URL & Zeitzone
- `/health` Operations Health Hub
- `/launch` finaler Go-Live Check

## Lokaler Build

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Supabase / Datenbank

Die reproduzierbare Datenbankhistorie liegt unter `supabase/migrations/` und umfasst fortlaufend Migration **001–049**. Für einen Neuaufbau die Migrationen in Reihenfolge anwenden; `supabase/schema.sql` ist nur die historische Baseline und ersetzt nicht die vollständige Migrationskette.

Edge Functions liegen vollständig unter `supabase/functions/`. Secrets gehören ausschließlich in Supabase Vault bzw. Provider-/Deployment-Secrets und niemals ins Repository.

### Automatische Worker

| Worker | Rhythmus | Aufgabe |
|---|---:|---|
| `walkenhorst-outbound-worker` | jede Minute | Sequenzen / E-Mail / Call Tasks |
| `walkenhorst-inbox-worker` | alle 5 Min. | Replies synchronisieren |
| `walkenhorst-automation-worker` | jede Minute | Automation Outbox |
| `walkenhorst-rinkel-reconcile` | alle 15 Min. | Rinkel CDR/Transcription nachziehen |
| `walkenhorst-bounce-worker` | alle 10 Min. | Hard-/Soft-Bounces |
| `walkenhorst-alert-worker` | alle 5 Min. | SLA- und Betriebsalerts |

## Go-Live Reihenfolge

1. App auf der endgültigen Produktionsdomain bereitstellen.
2. Unter `/settings` die **kanonische HTTPS-App-URL** speichern. Die Datenbank überschreibt damit Preview-URLs in Kampagnen automatisch.
3. Unter `/integrations` mindestens eine echte SMTP/IMAP-Mailbox verbinden und testen. Für den geplanten Betrieb bis zu fünf Mailboxen verbinden; Ramping zunächst konservativ lassen.
4. Rinkel verbinden, falls Calling/Call Intelligence genutzt wird.
5. Optional Firecrawl, Reacher, Google Maps, Chatwoot und Activepieces verbinden.
6. Leads über `/data` importieren oder über Lead Sources erzeugen.
7. `/data-hygiene` prüfen und High-Confidence-Dubletten nur bewusst mergen.
8. `/deliverability` und `/suppression` prüfen.
9. `/launch` öffnen. **Alle Pflichtchecks müssen grün sein**, bevor eine Kampagne aktiv geschaltet wird.
10. Erst mit kleinem Testsegment senden, Replies/Bounces prüfen und danach hochskalieren.

## Mail-Sicherheit

- Tageslimits und Ramping werden mailboxweise erzwungen.
- Reply stoppt die laufende Sequenz.
- Hard Bounce sperrt die E-Mail-Adresse persistent.
- Abmeldung erzeugt eine persistente Suppression, die auch nach Löschen/Re-Import greift.
- Tracking umfasst Open, verifizierte Click-Redirects und Unsubscribe.
- E-Mails enthalten zusätzlich `List-Unsubscribe` und `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Eine aktive Kampagne ohne gültige HTTPS-Tracking-Basis wird DB-seitig abgewiesen.
- Inbox-Platzierung wird nicht garantiert; SPF/DKIM/DMARC und Provider-Reputation müssen beim echten Mailsetup korrekt sein.

## PV Intelligence

PVGIS liefert einen Standort-Ertragsbenchmark. Bekannte Dachfläche kann in eine grobe kWp-/Jahreserzeugungs-Schätzung einfließen. Das System erfindet keine Verschattung, Dachstatik, Netzanschlussfähigkeit oder finale Wirtschaftlichkeit; diese Punkte benötigen technische Prüfung.

## Aktuelle externe Voraussetzungen

Für den ersten echten Betrieb werden noch die echten Walkenhorst-Daten benötigt:

- endgültige öffentliche Radar-Domain
- SMTP/IMAP-Zugangsdaten der Versand-Mailboxen
- Rinkel API Key / Webhook-Konfiguration, falls Calling genutzt wird
- reale Leads bzw. Importdatei
- optionale Provider-Keys für zusätzliche Intelligence/Automationen

Supabase Auth **Leaked Password Protection** sollte zusätzlich im Supabase-Dashboard aktiviert werden. Das ist eine Projekteinstellung und kein DB-Migrationsschritt.

## Abnahme

Der Feature-Stand wird vor Merge mit `npm run typecheck`, `npm run build`, Supabase Security Advisor, Worker-HTTP-Smokes und isolierten E2E-Tests für Tracking, Qualification, Proposal, Video Intent, Rinkel, Suppression, Duplicate Merge, Revival und Sales Priority geprüft.
