# Instance Boundary — CLIENT-WALKENHORST

This repository is the dedicated production instance for **Walkenhorst Energie**.

## Canonical identity

- Instance ID: `CLIENT-WALKENHORST`
- Company: `Walkenhorst Energie`
- GitHub: `ravoeee-droid/walkenhorst`
- Vercel project: `walkenhorst`
- Vercel project ID: `prj_x3nLVnqgVpKxJowHUjaN3iMswr9a`
- Supabase project: `walkenhorst-energy-radar`
- Supabase project ref: `jiahshldcusphxtbqxpv`

## Hard isolation rules

1. Never read from or write to another instance's production data, Supabase records, mailboxes, auth users, credentials, secrets, tracking data or integrations while working in this repository.
2. Read-only inspection of peer **source code** is explicitly allowed when needed to keep shared product functionality in parity.
3. Walkenhorst mailboxes, leads, campaigns, tracking data, integrations, secrets and auth users belong only to this instance.
4. Before any Vercel or Supabase operation, verify that the target IDs match the canonical identity above.
5. Do not point this frontend at another Supabase project. If the Supabase ref is not `jiahshldcusphxtbqxpv`, stop instead of deploying.
6. Never copy production customer data into another instance. Shared improvements are code only.

## Shared-core synchronization contract

The product is one shared outbound/sales core with isolated production instances. A shared-core change is **not complete** when it only exists in one instance.

When changing any shared product surface — CRM workflow UX, lead detail, caller queue, daily command center, campaign control, mailbox/status logic, pipeline, meetings, proposals, sales brief, navigation/application frame, generic Studio functionality, deliverability, system health or generic automation — you MUST:

1. Inspect the corresponding implementation in the peer product codebase.
2. Apply the equivalent improvement to both product instances in the same task, adapting APIs/data models instead of blindly copying files.
3. Preserve instance-specific branding, scoring, industry logic, integrations, databases, credentials and customer data.
4. Update `SHARED_CORE_STATUS.json` when a shared surface changes.
5. If parity cannot be completed safely, record the exact compatibility blocker in `SHARED_CORE_STATUS.json` and do not claim that the shared-core task is finished.

This contract applies in both directions: reusable improvements created first in Walkenhorst must be adapted back into Digitale Gewinner, and shared improvements created first in Digitale Gewinner must be adapted into Walkenhorst.

## Explicitly forbidden cross-instance runtime targets

The following must never be used as runtime/deployment/data targets from CLIENT-WALKENHORST. Their source code may only be inspected read-only for shared-core parity.

- `digitalegewinner-outbound`
- Vercel project `prj_4dgtSJI6FeoUezuUW13PNCFACvyL`
- Supabase project `digitalegewinner-outbound`
- Supabase ref `dessavbytgxyygeohjrn`

When a task is ambiguous, treat it as Walkenhorst only if the user explicitly references Walkenhorst or this repository is the active codebase. Shared-code parity is the only cross-instance exception and never permits cross-instance data access.

## ProjectAtlas — repository intelligence

ProjectAtlas is the preferred navigation layer for coding-agent work in this repository.

1. If `atlas_*` MCP tools are available, start a code task with one `atlas_session_brief` using the task as `query` and `compact: true`. If this checkout is not indexed yet, run `atlas_init` first.
2. Refresh with `atlas_watch_once` or `atlas_scan` only when the index may be stale after edits; do not rescan by habit.
3. Follow the selectors and typed next call returned by ProjectAtlas. Read the smallest exact source slice needed instead of broadly opening files.
4. Use broad repository search/read only when Atlas is unavailable or its focused result is insufficient.
5. For structural cleanup or refactors, use `atlas_health` and `atlas_lint` before considering the task complete.
6. `.projectatlas/` is checkout-local runtime state (database, generated MCP configs and telemetry) and must never be committed.
7. ProjectAtlas is an accelerator, not a blocker: if it is unavailable, continue with normal repository tools while preserving every isolation rule above.
