# Walkenhorst Energy Sales Radar

Eigenständiges Revenue-Intelligence-, CRM- und Outbound-System für Walkenhorst.

## Kernflow

`Lead → Research → PV/Energie-Potenzial → Priorität → Sales Brief → Call/E-Mail/Studio V3 → Intent → Termin → Angebot → Deal`

## Kernmodule

- Energy Lead Radar mit PV-, Energie-, Intent- und Contactability-Scoring
- PV Site Intelligence mit Standort-, Dachflächen-, kWp- und Ertragsindikatoren
- Sales Priority / Sales Brief
- CRM, Pipeline, Stage History, Forecast und Revenue Analytics
- Caller Queue + Rinkel-Historie, Recording und AI Insights
- Mailboxen, Ramping, Sequenzen, A/B-Varianten, Reply Stop und Inbox Sync
- Open/Click/Unsubscribe, Bounce Detection und persistente Suppression
- Hot-Lead/SLA Alerts, Revival und Data Hygiene
- Proposal Tracking
- **Studio V3 – Personalized Video Sales Studio**

## Studio V3

`/studio` ist kein einfacher Fake-Loom-Konfigurator mehr, sondern ein mehrspuriger Video- und Landingpage-Editor.

### Video Editor

- Apple-/Final-Cut-inspirierte Pro-Oberfläche
- Asset-Bibliothek links, Live-Canvas in der Mitte, Inspector rechts, Multi-Track-Timeline unten
- exakte Start-/Endzeiten in Millisekunden
- Clips verschieben und an beiden Seiten trimmen
- Snap-Raster von 0,05 bis 1,0 Sekunden
- Layer für Website, Video, Presenter, Bilder, Satellite/Map, Logo, Text, Shapes, Kennzahlen und Audio
- Position, Größe, Rotation, Opacity, Border Radius, Fit und Shadow pro Layer
- In-/Out-Animationen
- Website-/Bild-Keyframes für Scroll und Zoom
- Talking Head gleichzeitig über Website/Map/Proof
- Undo/Redo, Autosave und Version History
- 16:9, 9:16, 1:1 und 4:5
- dieselbe Timeline-Engine für Editor-Vorschau und öffentliche Kundenseite

### Personalisierung

Mastervorlagen können unter anderem verwenden:

`{{company}}` · `{{firstname}}` · `{{website}}` · `{{city}}` · `{{industry}}` · `{{problem}}` · `{{opportunity}}` · `{{roof_area}}` · `{{pv_kwp}}` · `{{pv_yield}}` · `{{energy_score}}` · `{{saving_estimate}}` · `{{cta}}`

Globale Mastervorlagen werden auf neue und bestehende Leads vererbt. Sobald ein Lead individuell geändert wird, wird er sauber vom Master getrennt; spätere Master-Updates überschreiben den Override nicht.

### Website Capture

- Full-Page-WebP-Capture
- Cookie-/Consent-Overlay-Bereinigung
- Lazy-Load-Priming
- SSRF- und Private-Network-Schutz
- bei manueller Bearbeitung als Lead-Asset speicherbar
- bei Kampagnen zusätzlich sicherer On-Demand-Capture pro öffentlichem `/v/<slug>`-Link

### Standort / Dach

Studio V3 kann echte Satellite-Standortbilder über die offizielle Google Static Maps API erzeugen.

- Koordinaten kommen aus `energy_site_intelligence`
- Google-Key bleibt im Supabase Vault
- Key wird nicht an den Browser ausgeliefert
- Kampagnen können Map-Layer automatisch pro Lead erzeugen und wiederverwenden

Dafür unter `/integrations` einmal **Google Satellite Maps** mit einem Google Maps Platform API-Key verbinden und testen.

### Walkenhorst Brand Kit

- Logo
- Portrait
- Primär-/Sekundär-/Akzentfarben
- Hintergründe und Textfarben
- Heading-/Body-Font
- Radius und Shadow
- Standard-CTA
- Trust Headline/Text
- Ansprechpartner

`Walkenhorst Branding synchronisieren` analysiert die öffentliche Markenwebsite und importiert Logo/Portrait anschließend in den eigenen Studio-Storage, damit Renderings nicht von fremden Cross-Origin-Assets abhängen.

### Landingpage Builder

Jede personalisierte `/v/<slug>`-Seite kann aus frei sortierbaren Blöcken bestehen:

- Hero
- Video
- Findings
- Kennzahlen
- Trust
- Andreas / Ansprechpartner
- Logos
- Proof / Cases
- Qualification
- CTA
- Kalender
- FAQ
- Footer

Jeder Block kann einzeln aktiviert, sortiert und gestaltet werden. Desktop- und Mobile-Preview sind im Builder enthalten.

### Rendering

Studio V3 besitzt einen echten Browser-Renderer:

- Canvas-Compositing der Video-/Bild-/Website-/Map-/Text-Layer
- Presenter-/Video-/Audio-Synchronisation
- Render-Fortschritt und Abbruch
- MP4, wenn der Browser H.264/MP4 über MediaRecorder unterstützt
- ansonsten WebM-Fallback
- Render-Ergebnisse werden bis zum aktuellen Storage-Limit automatisch im `energy-media`-Bucket gespeichert und mit der Video-Seite verbunden

Das aktuelle Supabase-Projekt erlaubt maximal **50 MB pro Einzeldatei**. Größere fertige Renderings bleiben lokal speicherbar, werden aber auf diesem Plan nicht automatisch in Supabase hochgeladen.

## Kampagnen + Studio V3

Der `campaign-worker` verwendet automatisch das im Campaign Lab ausgewählte Studio-Preset.

Bei `include_video=true`:

1. Lead-/Master-V3-Projekt laden
2. Brand Kit und PV-Site-Intelligence laden
3. Variablen in Timeline und Landingpage personalisieren
4. Presenter/Proof/Logo auflösen
5. fehlendes Satellite-Bild optional automatisch erzeugen
6. fehlenden Website-Capture über die sichere Public-Capture-Route bereitstellen
7. personalisierte `/v/<slug>`-Seite erzeugen/aktualisieren
8. `video_page_id` am Kampagnenmitglied speichern
9. personalisierten Link in die E-Mail einsetzen

Ein vorhandenes gerendertes Endvideo wird verworfen, wenn sich die Studio-Revision danach geändert hat, damit keine veraltete Version versendet wird.

## Öffentliche V3-Seite

Die Kundenseite verwendet exakt das gespeicherte V3-Projekt:

- gerendertes Endvideo, wenn vorhanden
- andernfalls dieselbe interaktive V3-Timeline wie im Studio
- Walkenhorst Brand Snapshot
- Landingpage-Blöcke
- Qualification Funnel
- CTA
- View/Play/25/50/75/90/100/CTA Tracking

RLS erlaubt anonym nur öffentliche `ready/sent`-Seiten und das Schreiben zulässiger Video-Events. Eventdaten selbst sind für anonyme Besucher nicht lesbar.

## Datenmodell Studio V3

- `energy_studio_configs` – Master-/Lead-Projekte und Vererbung
- `energy_studio_versions` – Version History
- `energy_media_assets` – Medienbibliothek
- `energy_brand_kits` – Branding
- `energy_render_jobs` – Render-Verlauf und Outputs
- `energy_video_pages` – veröffentlichte personalisierte Seite, V3-Timeline, Landingpage und Brand Snapshot
- Storage `energy-media` – Medien und Render-Outputs

Die reproduzierbare Datenbankhistorie unter `supabase/migrations/` umfasst aktuell Migration **001–056**.

## Wichtige Routen

- `/studio` Studio V3
- `/campaign-lab` Kampagnen + Studio-Preset
- `/integrations` Google Satellite Maps, Rinkel und weitere Provider
- `/command` Daily Command Center
- `/opportunities` Sales Priority
- `/sales-brief` Sales Brief
- `/calls` Caller Queue
- `/meetings` Meeting Prep
- `/pipeline` Pipeline
- `/analytics` Revenue Analytics
- `/proposals` Angebote
- `/pv-intelligence` PV Site Intelligence
- `/alerts` SLA Alerts
- `/deliverability` Deliverability
- `/suppression` Suppression Registry
- `/data-hygiene` Dubletten
- `/revival` Revival
- `/data` CSV Import/Export
- `/settings` Produktions-URL / Zeitzone
- `/health` Operations Health Hub
- `/launch` Go-Live Check

## Worker

| Worker | Rhythmus | Aufgabe |
|---|---:|---|
| `walkenhorst-outbound-worker` | jede Minute | Sequenzen, E-Mail, Studio-V3-Seiten, Call Tasks |
| `walkenhorst-inbox-worker` | alle 5 Min. | Replies synchronisieren |
| `walkenhorst-automation-worker` | jede Minute | Automation Outbox |
| `walkenhorst-rinkel-reconcile` | alle 15 Min. | Rinkel CDR/Transcription |
| `walkenhorst-bounce-worker` | alle 10 Min. | Bounces |
| `walkenhorst-alert-worker` | alle 5 Min. | SLA-/Betriebsalerts |

## Go-Live

1. endgültige öffentliche Radar-Domain setzen
2. `/studio` öffnen und Walkenhorst Brand Kit synchronisieren/speichern
3. echtes Andreas-Presenter-/Talking-Head-Video hochladen und als Presenter binden
4. Master-Timeline und Landingpage final aufbauen
5. unter `/integrations` Google Satellite Maps verbinden, falls Dach-/Satellite-Layer genutzt werden
6. SMTP/IMAP-Mailboxen verbinden und testen
7. optional Rinkel / Firecrawl / Reacher / Chatwoot / Activepieces verbinden
8. Testlead auswählen, Website-/Map-Layer prüfen, `/v/<slug>` veröffentlichen
9. kleinen Kampagnen-Pilot starten
10. Deliverability, Replies, Video-Watchtime, CTA und Termine messen
11. erst danach Versand hochskalieren

## Mail-Sicherheit

- Tageslimits und Ramping pro Mailbox
- Reply stoppt laufende Sequenz
- Hard Bounce sperrt persistent
- Unsubscribe bleibt auch nach Re-Import aktiv
- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- Kampagnen benötigen eine gültige HTTPS-Tracking-Basis
- Inbox-Platzierung wird nicht garantiert; SPF/DKIM/DMARC und Provider-Reputation müssen korrekt sein

## Externe Voraussetzungen für den echten Betrieb

- endgültige öffentliche Radar-Domain
- echtes Andreas-Presenter-Video
- echte SMTP/IMAP-Zugangsdaten
- Google Maps Platform API-Key, falls Satellite-/Dachbilder genutzt werden
- Rinkel API-Key, falls Calling genutzt wird
- reale Leads
- optionale Provider-Keys für zusätzliche Intelligence/Automationen

Supabase Auth **Leaked Password Protection** sollte im Supabase-Dashboard aktiviert werden. Das ist eine Projekteinstellung, keine DB-Migration.

## Abnahme vor V3-Merge

- `npm install`
- `npm audit --omit=dev --audit-level=high`
- `npm run typecheck`
- `npm run build`
- Vercel Preview
- Supabase Security + Performance Advisor
- Master → Lead → Override → Master-Update E2E
- öffentliche V3-Seite + anon Event-Write/RLS E2E
- Worker-V3-Seitengenerierung E2E ohne realen Versand
- vollständiges Entfernen aller Testdaten und Test-Secrets
- bestehende CRM-/Tracking-/Qualification-/Rinkel-/Suppression-Flows dürfen nicht regressieren
