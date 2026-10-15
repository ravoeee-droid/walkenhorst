# Walkenhorst Cloudflare recovery

Production: https://walkenhorst.ravoeee.workers.dev

This instance uses Workers static assets, a Supabase-compatible authenticated API adapter and D1 `walkenhorst-crm`. Existing verified user hashes and workspace ownership were imported privately. Source Supabase data was not deleted. `walkenhorst.vercel.app` redirects to this instance.

Verified on 2026-10-15: actual existing-user browser login, CRM list and lead detail, creating a separate synthetic lead, saving it through the UI and confirming the value in D1. The synthetic record was removed. All 23 nonempty exported table counts match; 1,254 leads and 1,224 contacts remain. Eight local integration/query tests pass.

## Limits of this recovery

Core login and CRM record access are live. This is not full Supabase feature parity. Automation endpoints, SMTP/IMAP sending and syncing, RPCs, signup/password reset, destructive client deletes and generic upserts remain disabled. Imported aggregate views are snapshots. Media uploads and rendering are blocked. Existing video URLs may fail while the old Supabase project is quota-blocked. Do not present mailbox status or imported automation status as current health.

## Storage protection

Media writes are blocked both in the client and server; rendering is disabled in the repository workflow. D1 triggers reject CRM JSON growth above 200 MB, leaving room for authentication. This reduces the media-quota failure mode; free-tier request or database limits can still interrupt service. No paid plan was enabled.

## Build and release

Install pinned dependencies with `npm ci`; run `npm test`, `npm run build`, then `npx vite build --ssr src/worker.mjs --outDir build-worker`. `scripts/deploy-api.mjs` uses the documented Cloudflare upload APIs because Wrangler's esbuild format detection fails under this Windows filesystem sandbox. It reads the existing authorized Wrangler OAuth profile privately and generates/reuses a private session secret. It uploads only `dist` and the compiled Worker.

Do not commit or upload `private`, `.wrangler`, credentials, exports, password hashes or `import.sql`. Database import is a one-time operation against an empty destination; never rerun on live data. `scripts/create-import.mjs` and `verify-import.mjs` enforce the source inventory. `scripts/cleanup-verification.mjs` only matches the named synthetic test ID.

The shared CRM form fix captures the form before awaiting authentication. Shared-core peer parity is explicitly pending in the root status file; peer runtime and data were untouched.

## Synthetic landing-page playback test

`/v/erster-flow/` is a public, synthetic preview without customer data, presenter footage, sound, tracking or messages. Its CTA only displays a local confirmation. Generate the 18-second MP4 and poster with `scripts/create-demo.py` before building (requires Pillow and `imageio-ffmpeg==0.6.0` in `private/video-runtime`). Generated media is ignored by Git and served as small static assets, independently of the blocked source Supabase storage. This does not enable bulk media uploads, automatic rendering or production outreach.
