# Walkenhorst Energy Sales Radar

Eigenständiges Revenue-Intelligence- und Outbound-System für Walkenhorst. Dieses Repository ist bewusst vollständig von Pflege-, Julian-Arndt- und anderen Kundenprojekten getrennt.

## Enthalten

- Energy Lead Radar mit PV-/Energie-/Intent-/Contactability-Scoring
- CRM Status und Next Best Action
- personalisierte Fake-Loom-Landingpages `/v/<slug>`
- View-, Play-, Watch-%- und CTA-Tracking
- Mailbox-Konfiguration mit sicheren Tageslimits
- Kampagnen-Templates
- Website Intelligence Schnell-Audit mit SSRF-Schutz
- kostenloser SEO Keyword Radar ohne erfundene Suchvolumenwerte
- Supabase RLS-Schema für getrennte Datenhaltung

## Start

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Supabase

1. Eigenes Supabase-Projekt nur für Walkenhorst erstellen.
2. `supabase/schema.sql` im SQL Editor ausführen.
3. In Vercel hinterlegen:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - optional `NEXT_PUBLIC_WALKENHORST_CALENDAR_URL`
4. Neu deployen.
5. Auf der Startseite den ersten Account erstellen und anmelden.

## Fake Loom Flow

Lead → Opportunity Score → Video-Seite erzeugen → `/v/<slug>` versenden → View/Watch/CTA wird in `energy_video_events` gespeichert → Dashboard zeigt Intent.

Für echtes Presenter-Video kann pro Video-Seite später eine MP4/WebM-URL hinterlegt werden. Ohne Presenter-Video zeigt die V1 einen gebrandeten Talking-Head-Platzhalter.

## Nächste Integrationen

- Google Ads Keyword Planning für echtes Suchvolumen/CPC
- Google PageSpeed/CrUX für Core Web Vitals
- Mailprovider/OAuth für echten Versand und Reply Detection
- Telephony/Call Tracking
- Maps/Unternehmensdaten/Entscheider-Anreicherung
- optional Screenshot-Service für echte Website-Aufnahmen im Video
