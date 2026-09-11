# OSS Autopilot provenance

Shared-core parity adaptation for DG's experimental OSS intelligence layer. No DG customer/runtime data is used.

- Firecrawl: `firecrawl/firecrawl`, JS SDK 4.39.0, MIT. Adapter preserves official `/v2/scrape` and bounded resume semantics.
- Stagehand: `browserbase/stagehand`, `@browserbasehq/stagehand` 4.1.0, MIT. Worker uses the real v4 Browserbase/Stagehand lifecycle and `extract()`.
- Trigger.dev: `triggerdotdev/trigger.dev`, current observed `@trigger.dev/sdk` 4.5.16. Adapter uses official `/api/v1/tasks/{taskIdentifier}/trigger` semantics and retry behavior.
- PostHog: public capture API only; PostHog application source is not copied.
- Inbox Zero is intentionally not copied because its current AGPLv3 license includes additional commercial/enterprise restrictions.

Research is restricted to public HTTP(S) targets. No cross-instance credentials, Supabase refs, leads, tracking data or branding are copied.
