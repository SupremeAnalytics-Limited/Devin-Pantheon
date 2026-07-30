# Devin Pantheon Tasks

## Current Tasks (CarSpa)
- [x] Decide SMS vs email for post-call follow-up → SMS, via Synthflow's native post-call action.
- [x] Confirm phone number: `+1 437 525 4343` is the live business-card number.
- [x] Decide employee-vs-customer call routing → Devin asks at the start of the call.
- [x] Decide employee onboarding email timing → right after the call ends (post-call webhook), not mid-call.
- [x] Set up D1 database for CarSpa call logs → `carspa-calls` (uuid `7858276e-f1f8-4649-be27-76d664c09efe`), `calls` + `bookings` tables live.
- [x] Build the Synthflow webhook worker code (`call_inbound` + post-call events, customer/employee branch) and the Calendly `invitee.created`/`invitee.canceled` webhook endpoint — both in `carspa-synthflow-worker/`, type-checks clean.
- [ ] **Deploy the worker** (`wrangler deploy`) — blocked: no `wrangler` CLI or Cloudflare API token available in this build sandbox. Needs Simon's machine, or a `CLOUDFLARE_API_TOKEN` handed to this session.
- [ ] Migrate `SYNTHFLOW_API_KEY` from `config/credentials.json` (plaintext) to a Cloudflare Worker secret — same deploy-access blocker.
- [ ] Point Synthflow's inbound + post-call webhooks at the deployed worker URL; configure information extractor fields (`caller_type`, `name`, `service_requested`, `role`, `email`) on the CarSpa agent.
- [ ] Create the Calendly `invitee.created`/`invitee.canceled` webhook subscription (dashboard or API — not exposed by this session's Calendly MCP tools) and store the returned signing key as `CALENDLY_WEBHOOK_SIGNING_KEY`.
- [ ] Verify actual Synthflow payload field names against a real call — `docs.synthflow.ai` was unreachable from this build session (network policy blocked the host), so current field-name assumptions in `src/index.ts` are best-effort.
- [ ] Get employee onboarding email content/materials from Simon; decide the sending provider (worker defaults to Resend if configured) and wire in real content.
- [ ] Revisit Calendly Team/Round Robin pricing once staff (Node 2+) exist.

## Archived Tasks (Car Brokerage Pilot — Paused)
- [x] Trigger first Synthflow call via Sarah persona.
- [x] Sarah to qualify Kelly and identify her phone number via call.
- [x] Sync latest call transcript to memory.
- [x] Fix Sarah-to-Devin action dispatch (`dispatch_devin_v3`).
- [x] Initialize GitHub memory repository structure.
- [x] Configure Git authentication in Manus sandbox.
- [x] Establish "Agent Brain" Identity and Bootstrap System.
- [x] Programmatically Create Sarah (Intelligence Officer & Co-Architect).
- [x] Attach Actions (Image Retrieval & Devin Dispatch) to Sarah.
- [x] Integrate Buyer Database into Pantheon.
- [x] Implement Manus API Bridge and Webhook Listener.
- [x] Integration test PASSED: Sarah successfully identifies Kelly and updates Pantheon memory.
- [x] Knowledge Sync: Updated IDENTITY.md, state.md, and tasks.md for persistent memory.
- [ ] (Not carried forward) Implement Wake-Sync-Act-Sleep Python script (V2 Integration).
- [ ] (Not carried forward) Schedule recurring cron task for autonomous runs.
- [ ] (Not carried forward) Resolve 404 for `GET_VEHICLE_IMAGES` by implementing the "Live Bridge" endpoint or mock server.
- [ ] (Not carried forward) Automate Buyer Outreach based on Sarah's "Hot" signal.
