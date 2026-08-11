# Walkenhorst Energy Sales OS

Eigenständiges Lead-Finder-, Outbound-, Fake-Loom- und Sales-CRM-System für Walkenhorst. Das Repository und die Supabase-Datenbank sind vollständig von Pflege-, Julian-Arndt- und anderen Kundenprojekten getrennt.

## Produktflow

Lead Finder → Import/Enrichment → Energy Opportunity Score → CRM → Kampagne → personalisierte E-Mail → automatische Fake-Loom-Seite → Open/Click/Video-Intent → Reply/Follow-up → Termin/Deal.

## Enthalten

- Lead Finder für gewerbliche Zielgruppen mit Standort/Radius, OpenStreetMap-Daten und Website-Enrichment
- CSV-Import und Dubletten-Schutz
- Energy Opportunity Scoring: PV, Energieeffizienz, Intent und Kontaktierbarkeit
- Sales CRM als Tabelle und Kanban-Pipeline
- Lead-Detail mit Sales Angle, Status und Unified Timeline
- Fake-Loom-Studio mit personalisierten `/v/<slug>` Landingpages
- gesäuberte Live-Vorschau der echten Prospect-Website im Fake-Loom-Player
- optionales Talking-Head-Video mit Audio nach Play-Klick
- View-, Play-, 25/50/75/90/100-%- und CTA-Tracking
- automatische Hot-Lead-Follow-ups bei starkem Video-Intent
- SMTP-Mailboxen mit Tageslimits; Passwörter liegen verschlüsselt im Supabase Vault
- IMAP-Antwort-Sync und automatische Reply-Erkennung
- Kampagnen mit Sequenzschritten: E-Mail, Video-E-Mail, Wait und Call-Aufgabe
- automatische personalisierte Variablen `{{firstname}}`, `{{company}}`, `{{city}}`, `{{industry}}`, `{{opportunity}}`, `{{reason}}`, `{{video_url}}`
- Versandfenster, Kampagnen- und Mailboxlimits sowie idempotente Versandlogik gegen Doppelversand
- E-Mail Open-/Click-Tracking und bestätigter Unsubscribe-Flow
- Inbox, Follow-ups und Vorlagen
- Website Intelligence Audit mit PDF-/Druckexport
- SEO Keyword Radar ohne erfundene Suchvolumenwerte
- Supabase RLS, SSRF-Schutz, sichere Tracking-Redirects und Edge-Function-Backend
- automatischer Campaign Worker über `pg_cron` + `pg_net`

## Deployment

```bash
npm install
npm run typecheck
npm run build
```

Supabase-Migrationen liegen unter `supabase/migrations/`, Edge Functions unter `supabase/functions/`.

Benötigte öffentliche Frontend-Konfiguration:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- optional `NEXT_PUBLIC_WALKENHORST_CALENDAR_URL`

## Mailbox-Setup

In **Integrationen** SMTP- und optional IMAP-Daten des Postfachs eintragen und speichern. Das Passwort wird nicht in der normalen Mailbox-Tabelle gespeichert. Danach **Test** ausführen. Nur Mailboxen mit Status `ready` werden vom Campaign Worker für Versand verwendet.

## Kampagnen-Sicherheit

- Ohne aktive Kampagne wird nichts versendet.
- Ohne getestete `ready` Mailbox wird nichts versendet.
- Tageslimits gelten pro Mailbox und Kampagne.
- `do_not_contact` / Unsubscribe stoppt weitere Ansprache.
- Erkannte Antworten stoppen die Sequenz und erzeugen einen Hot-Follow-up.
- `(campaign_member_id, step_order)` ist für Outbound-Nachrichten eindeutig, damit Worker-Retries keinen Doppelversand erzeugen.

## Freie Datenquellen

Die V1 nutzt öffentliche OpenStreetMap-/Nominatim-/Overpass-Daten mit konservativen Limits und unterstützt eigene Endpoints über `NOMINATIM_BASE_URL` bzw. `OVERPASS_BASE_URL`. Für größere Volumina sollte später eine eigene/gehostete Datenquelle oder ein kommerzieller Provider angeschlossen werden.

## Noch externe Voraussetzungen

- Ein echter SMTP/IMAP-Account muss einmal in **Integrationen** hinterlegt und getestet werden; Zugangsdaten können nicht sinnvoll im Repository vorgegeben werden.
- Exakte Google-Ads-Suchvolumina benötigen später eine Google-Ads-API-Anbindung. Die kostenlose SEO-V1 erfindet bewusst keine Volumenwerte.
- Ein echtes Cold-E-Mail-Warm-up-Netzwerk ist kein Bestandteil der V1; Deliverability wird über konservative Limits, saubere Mailboxen und Stop-/Bounce-/Reply-Logik abgesichert.
