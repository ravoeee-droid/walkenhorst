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

1. Never read from, write to, deploy to, or reuse credentials from the Digitale Gewinner instance while working in this repository.
2. Walkenhorst mailboxes, leads, campaigns, tracking data, integrations, secrets and auth users belong only to this instance.
3. Before any Vercel or Supabase operation, verify that the target IDs match the canonical identity above.
4. Do not point this frontend at another Supabase project. If the Supabase ref is not `jiahshldcusphxtbqxpv`, stop instead of deploying.
5. Do not copy production customer data into a master/core repository. Shared improvements may be ported as code only.

## Explicitly forbidden cross-instance targets

- `digitalegewinner-outbound`
- Vercel project `prj_4dgtSJI6FeoUezuUW13PNCFACvyL`
- Supabase project `digitalegewinner-outbound`
- Supabase ref `dessavbytgxyygeohjrn`

When a task is ambiguous, treat it as Walkenhorst only if the user explicitly references Walkenhorst or this repository is the active codebase.