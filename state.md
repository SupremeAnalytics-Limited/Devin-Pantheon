# Devin Pantheon State

## Project Overview
Devin is an AI voice intake and dispatch agent for **CarSpa**, Simon Onabanjo's mobile car detailing business in Lethbridge, AB ($120/car, ~3hr per job). Devin answers the business-card phone number via Synthflow, onboards the customer, texts them the Calendly booking link, and becomes aware of bookings via a Calendly webhook.

## Business Snapshot
- **Booking history:** 9 total bookings since Aug 2025. 7 landed in a 5-week burst (Aug 20–Sep 27, 2025), then ~10 months dormant. Restarted July 27, 2026.
- **Best-converting segment:** women/moms with kids — responds well to "I come to you, no need to find time for it."
- **Recurring customer:** one male customer locked in for August 2026.
- **Simon's availability:** Part-time Maintenance Supervisor at Chartwell Retirement Residences ($22.94/hr); CarSpa is paused while he stabilizes those hours. This build is prep work for when he returns to running CarSpa full force.
- **Calendly:** Event type "CarSpa's Detailing Calendar", account `supremeesimon@gmail.com`, timezone America/Denver.

## Current Status
- **Phase:** Build (pre-launch). Worker code written and D1 live; not yet deployed to Cloudflare.
- **Voice platform:** Synthflow, chosen over VAPI for Canadian phone number support.
- **Phone number:** `+1 437 525 4343` — this is the live business-card number, already provisioned (reused from the retired brokerage pilot; same account/key, new agent config).
- **Post-call follow-up channel:** **SMS** (decided — via Synthflow's native post-call action, not a separate Twilio/Resend integration).
- **Employee onboarding channel (new):** Same phone number now serves two intents. Devin asks at the start of the call whether the caller is booking a detail (customer) or joining the team (employee), then branches. Employee calls: capture name/contact/role during the call, log to D1; **onboarding email content is not yet defined** (Simon to provide materials) — build the data-capture + post-call email trigger plumbing now, wire in real email content later. Email sends after the call ends (post-call webhook), same timing pattern as the customer SMS.
- **Cloudflare account:** 12 Workers already deployed under the broader "Devin v1.1" marketing/automation OS (SupremeAnalytics). Pattern to follow for the new worker: `vibe-devin-brain-production` (webhook receiver → verify → process → D1 log → optional Claude-in-the-loop decision → respond).
- **D1 databases live:** `vibe-devin`, `vibe-whatsapp`, `vibe-orders`, and now **`carspa-calls`** (uuid `7858276e-f1f8-4649-be27-76d664c09efe`) with `calls` + `bookings` tables/indexes applied.
- **Worker code exists** at `carspa-synthflow-worker/` in this repo (routes: `/synthflow-webhook`, `/calendly-webhook`), type-checks clean. **Not yet deployed** — this build session has no `wrangler` CLI or Cloudflare API token, only D1/KV/R2 management via MCP tools. Deployment needs Simon's machine or a `CLOUDFLARE_API_TOKEN` handed to a session that has `wrangler`.
- **Docs access blocked:** `docs.synthflow.ai` and `docs.calendly.com` are unreachable from this build session (network policy blocks the hosts at the proxy). Payload field-name assumptions in the worker code are best-effort from Simon's own prior research — flagged with TODOs, need verifying against real traffic.

## Key Decisions Made
- Synthflow over VAPI (Canadian numbers).
- SMS over email for post-call Calendly link + flyer delivery.
- No cold automated outreach — every reactivation call requires Simon's prior in-person/verbal consent.
- API keys (Synthflow, etc.) go in as Cloudflare Worker secrets (`wrangler secret put`), never pasted into chat or committed to code.
- Calendly stays strictly customer-facing bookings; Simon uses Google Calendar for personal time-blocking.

## Immediate Next Steps
1. Migrate `SYNTHFLOW_API_KEY` out of `config/credentials.json` into a Cloudflare Worker secret (`wrangler secret put`) — currently sits in plaintext in the repo.
2. Set up D1 database for call logs (`carspa-calls` or similar) — schema needs a `call_type` (customer vs employee) distinction.
3. Build and deploy the Synthflow webhook worker (`call_inbound` + post-call events), with call-type branching for customer intake vs employee onboarding.
4. Build the Calendly `invitee.created` webhook endpoint.
5. Get employee onboarding email content from Simon once available; wire it into the post-call email send.
6. Revisit Calendly Team/Round Robin pricing once staff exist (not urgent — Simon is still Node 1 only).

## Archived: Car Brokerage Pilot (Paused)
Devin's original scope (Kijiji car-seller scraping, "Sarah" persona, finder's-fee brokerage) is paused, not active. See `README.md` for what's archived. Historical metrics from that pilot (kept for reference only, not current):
| Metric | Value |
| :--- | :--- |
| Total Listings Found | 1 |
| Numbers Extracted | 1 (Kelly: +1 555 123 4567) |
| Deals Closed | 0 |
| Total Fees Collected | $0 |
