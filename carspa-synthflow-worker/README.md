# CarSpa Synthflow Worker

Cloudflare Worker that backs Devin, CarSpa's voice intake/dispatch agent. Two routes:

- `POST /synthflow-webhook` — handles both Synthflow events on one endpoint:
  - `event: "call_inbound"` (fires within ~10s of a call starting): logs the attempt and responds with `{ "call_inbound": { "override_model_id": "" } }` to keep the call with the agent that answered (single agent/number today — revisit once staff/nodes exist).
  - Post-call event (call ended): parses status/duration/transcript/extracted fields, upserts into D1, and — for employee calls — triggers a post-call onboarding email.
- `POST /calendly-webhook` — handles `invitee.created` / `invitee.canceled`, logs bookings to D1.

## Status: code written, not yet deployed

This session has Cloudflare D1/KV/R2 management tools but no Worker-deploy or secret-set tool, and no `wrangler` CLI or Cloudflare API token in this sandbox. So:

- The `carspa-calls` D1 database **has been created** and this schema **has been applied** (via the Cloudflare MCP tools), database_id `7858276e-f1f8-4649-be27-76d664c09efe`.
- The Worker itself still needs `wrangler deploy` run from an environment with real Cloudflare credentials (Simon's machine, or hand this session a `CLOUDFLARE_API_TOKEN`).

## Setup (once deploying)

```bash
npm install
wrangler secret put SYNTHFLOW_WEBHOOK_TOKEN      # pick any random string; append ?token=<value> to the URL given to Synthflow
wrangler secret put CALENDLY_WEBHOOK_SIGNING_KEY  # returned when the Calendly webhook subscription is created
# Optional, only once an email provider is chosen for employee onboarding:
wrangler secret put RESEND_API_KEY
wrangler secret put ONBOARDING_EMAIL_FROM
wrangler deploy
```

## Manual steps outside this repo

1. **Synthflow dashboard**: point the CarSpa agent's inbound + post-call webhooks at `https://<deployed-worker>.workers.dev/synthflow-webhook?token=<SYNTHFLOW_WEBHOOK_TOKEN>`. Configure an information extractor field named `caller_type` (`customer` | `employee`) plus `name`, `service_requested`, `role`, `email` as applicable — the worker reads these field names; rename in `src/index.ts` if the agent config uses different keys.
2. **Calendly**: create a webhook subscription for `invitee.created` (and `invitee.canceled`) on the "CarSpa's Detailing Calendar" event type, pointed at `https://<deployed-worker>.workers.dev/calendly-webhook`. This session's Calendly MCP tools don't expose subscription creation — do it via the Calendly dashboard (Integrations → Webhooks) or a direct API call, and store the returned `signing_key` as `CALENDLY_WEBHOOK_SIGNING_KEY`.

## Known open items (see repo-root `tasks.md`)

- Exact Synthflow payload field names are unverified — `docs.synthflow.ai` was unreachable from this build session (network policy blocked the host). `raw_payload` is stored on every row so nothing is lost if a guessed field name is wrong; reconcile once real calls come in.
- Employee onboarding email content is a placeholder pending materials from Simon.
- Email provider for onboarding emails isn't chosen yet (worker defaults to Resend's API if `RESEND_API_KEY`/`ONBOARDING_EMAIL_FROM` are set; otherwise it logs and skips sending).
