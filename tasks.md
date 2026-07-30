# Devin Pantheon Tasks

## Current Tasks (CarSpa)
- [x] Decide SMS vs email for post-call follow-up → SMS, via Synthflow's native post-call action.
- [x] Confirm phone number: `+1 437 525 4343` is the live business-card number.
- [x] Decide employee-vs-customer call routing → Devin asks at the start of the call.
- [x] Decide employee onboarding email timing → right after the call ends (post-call webhook), not mid-call.
- [ ] Migrate `SYNTHFLOW_API_KEY` from `config/credentials.json` (plaintext) to a Cloudflare Worker secret.
- [ ] Set up D1 database for CarSpa call logs (with customer/employee call-type distinction).
- [ ] Build and deploy the Synthflow webhook worker (`call_inbound` + post-call events), following the `vibe-devin-brain-production` pattern, with customer-intake and employee-onboarding branches.
- [ ] Build the Calendly `invitee.created` webhook endpoint.
- [ ] Get employee onboarding email content/materials from Simon; wire into post-call email send (data capture ships first, real content lands later).
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
