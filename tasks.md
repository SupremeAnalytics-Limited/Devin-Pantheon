# Devin Pantheon Tasks

## Current Tasks (CarSpa)
- [x] Decide SMS vs email for post-call follow-up → SMS, via Synthflow's native post-call action.
- [ ] Get/confirm Synthflow API key and account access (Simon to provide as a Cloudflare Worker secret).
- [ ] Set up D1 database for CarSpa call logs.
- [ ] Build and deploy the Synthflow webhook worker (`call_inbound` + post-call events), following the `vibe-devin-brain-production` pattern.
- [ ] Build the Calendly `invitee.created` webhook endpoint.
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
