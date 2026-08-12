# Walkenhorst Energy Sales Radar

Produktionsnahes Revenue-Intelligence-, CRM- und Outbound-System für Walkenhorst. Das Projekt ist eigenständig und von anderen Kundenprojekten getrennt.

## Kernflow

`Lead → Research → PV/Energie-Potenzial → Opportunity Priority → Sales Brief → Call/E-Mail/Studio-Video → Intent → Termin → Angebot → Deal`

## Enthalten

- Energy Lead Radar mit PV-, Energie-, Intent- und Contactability-Scoring
- Sales Priority V2 mit echten Intent-/PV-Signalen
- evidence-basierter Sales Brief mit Opener, Fragen und Next Best Action
- CRM, Pipeline, Stage History, Forecast und Revenue Analytics
- Caller Queue mit Rinkel-Call-Historie, AI Insights, Recording und Call Outcomes
- Rinkel Webhook + Reconciliation
- **Studio V2** auf Basis der stärkeren früheren Digitale-Gewinner-Studio-Architektur
- Studio-Mastervorlagen plus automatische Lead-Vererbung und sichere Lead-Overrides
- fünf Energie-Presets: PV Gewerbe, Energieberatung, große Dachfläche, hohe Energiekosten, Förderung & Effizienz
- echte Segment-Timeline: Website, Presenter/Sprecher, Proof-Video und Bilder
- Full-Page-Website-Capture mit Cookie-Overlay-Bereinigung, Lazy-Load-Priming und SSRF-Schutz
- gemeinsamer Segment-Player für Studio-Vorschau und öffentliche `/v/<slug>`-Landingpage
- Timeline-Scrubbing, Segment-Sprünge, ±10 Sekunden, 1–2× Speed, Mute, Fullscreen und Talking Head
- Media Library in eigenem Supabase-Storage-Bucket
- resumierbare TUS-Uploads für große Studio-Videos mit sichtbarem Upload-Fortschritt
- personalisierte Video-Landingpages `/v/<slug>`
- View-, Play-, Watch-25/50/75/90/100-, CTA- und Qualification-Tracking
- automatischer Outbound-Worker nutzt die aktuelle Studio-V2-Master-/Lead-Vorlage statt Legacy-Fake-Loom-Seiten
- Studio-Preset pro Kampagne direkt im Campaign Lab wählbar
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
- `/studio` **Landingpage & Video Studio V2**
- `/calls` Caller Queue
- `/meetings` Meeting Prep
- `/pipeline` Pipeline
- `/analytics` Revenue Analytics
- `/campaign-lab` Kampagnen/A-B Tests + Studio-V2-Template pro Kampagne
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

Die CI prüft zusätzlich die Production-Dependencies mit `npm audit --omit=dev --audit-level=high`.

## Supabase / Datenbank

Die reproduzierbare Datenbankhistorie liegt unter `supabase/migrations/` und umfasst fortlaufend Migration **001–053**. Für einen Neuaufbau die Migrationen in Reihenfolge anwenden; `supabase/schema.sql` ist nur die historische Baseline und ersetzt nicht die vollständige Migrationskette.

Edge Functions liegen vollständig unter `supabase/functions/`. Secrets gehören ausschließlich in Supabase Vault bzw. Provider-/Deployment-Secrets und niemals ins Repository.

### Studio V2 Datenhaltung

- `energy_studio_configs`: globale Mastervorlagen und Lead-Konfigurationen
- `energy_media_assets`: private Medien-Metadaten pro Nutzer
- `energy_video_pages`: veröffentlichte personalisierte Landingpages inkl. aufgelöster Studio-Timeline
- Storage Bucket `energy-media`: öffentliche Asset-Auslieferung für Landingpages, aber Schreiben/Ändern/Löschen nur im eigenen Auth-Nutzerordner
- Lead-Konfigurationen erben globale Mastervorlagen automatisch. Sobald ein Lead individuell geändert wird, wird er vom Master gelöst und spätere Master-Updates überschreiben diesen Override nicht.

### Automatische Worker

| Worker | Rhythmus | Aufgabe |
|---|---:|---|
| `walkenhorst-outbound-worker` | jede Minute | Sequenzen / E-Mail / Studio-V2-Video / Call Tasks |
| `walkenhorst-inbox-worker` | alle 5 Min. | Replies synchronisieren |
| `walkenhorst-automation-worker` | jede Minute | Automation Outbox |
| `walkenhorst-rinkel-reconcile` | alle 15 Min. | Rinkel CDR/Transcription nachziehen |
| `walkenhorst-bounce-worker` | alle 10 Min. | Hard-/Soft-Bounces |
| `walkenhorst-alert-worker` | alle 5 Min. | SLA- und Betriebsalerts |

## Studio V2 Bedienung

1. `/studio` öffnen und **Standard für alle Leads** wählen.
2. Gewünschtes Energie-Preset wählen und Headline, Unterzeile, CTA, Farbe und Presenter-Name konfigurieren.
3. Presenter-/Talking-Head-Video und optional Proof-Videos/Bilder in die Medienbibliothek hochladen.
4. Presenter festlegen und Timeline ordnen. Die Vorschau nutzt exakt denselben Player wie die spätere Kundenseite.
5. Globale Vorlage speichern. Sie wird automatisch an bestehende und neue Leads vererbt.
6. Für einen konkreten Lead die Website aufnehmen. Dadurch entsteht ein echter Full-Page-WebP-Screenshot, der im Player automatisch scrollt.
7. Falls nötig Lead individuell anpassen und `Live veröffentlichen` wählen.
8. Im `/campaign-lab` je Kampagne das passende Studio-Preset auswählen. Bei Video-Schritten erzeugt/aktualisiert der Worker die personalisierte Seite automatisch vor dem Versand.

Unterstützte Variablen:

`{{company}}` · `{{firstname}}` · `{{website}}` · `{{city}}` · `{{problem}}` · `{{opportunity}}` · `{{cta}}`

## Go-Live Reihenfolge

1. App auf der endgültigen Produktionsdomain bereitstellen.
2. Unter `/settings` die **kanonische HTTPS-App-URL** speichern. Die Datenbank überschreibt damit Preview-URLs in Kampagnen automatisch.
3. Unter `/studio` die Walkenhorst-Mastervorlage inkl. echtem Presenter-Video konfigurieren und speichern.
4. Unter `/integrations` mindestens eine echte SMTP/IMAP-Mailbox verbinden und testen. Für den geplanten Betrieb bis zu fünf Mailboxen verbinden; Ramping zunächst konservativ lassen.
5. Rinkel verbinden, falls Calling/Call Intelligence genutzt wird.
6. Optional Firecrawl, Reacher, Google Maps, Chatwoot und Activepieces verbinden.
7. Leads über `/data` importieren oder über Lead Sources erzeugen.
8. `/data-hygiene` prüfen und High-Confidence-Dubletten nur bewusst mergen.
9. Für ein kleines Testsegment Website-Captures erzeugen und im Studio kontrollieren.
10. `/campaign-lab` Video-Preset und Mailvarianten prüfen.
11. `/deliverability` und `/suppression` prüfen.
12. `/launch` öffnen. **Alle Pflichtchecks müssen grün sein**, bevor eine Kampagne aktiv geschaltet wird.
13. Erst mit kleinem Testsegment senden, Replies/Bounces/Video-Intent prüfen und danach hochskalieren.

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
- echtes Walkenhorst-Presenter-/Talking-Head-Video
- SMTP/IMAP-Zugangsdaten der Versand-Mailboxen
- Rinkel API Key / Webhook-Konfiguration, falls Calling genutzt wird
- reale Leads bzw. Importdatei
- optionale Provider-Keys für zusätzliche Intelligence/Automationen

Supabase Auth **Leaked Password Protection** sollte zusätzlich im Supabase-Dashboard aktiviert werden. Das ist eine Projekteinstellung und kein DB-Migrationsschritt.

## Abnahme

Vor einem Studio-V2-Merge werden mindestens geprüft:

- `npm install`
- `npm audit --omit=dev --audit-level=high`
- `npm run typecheck`
- `npm run build`
- Supabase Security + Performance Advisor
- Storage-/Studio-RLS
- Master → Lead → Override → Master-Update
- öffentliche `/v/<slug>`-RLS + Video-Event-Write
- Worker HTTP-Smoke
- bestehende Tracking-, Qualification-, Proposal-, Rinkel-, Suppression-, Duplicate-, Revival- und Sales-Priority-Flows
