# Devin Pantheon Goals

## Primary Goal
Build and operate CarSpa's automated voice intake and booking dispatch system, so Simon can eventually step back from fieldwork entirely while Devin + hired staff ("nodes") keep the business running.

## Objectives
- **Answer Every Call:** Devin (Synthflow voice agent) answers CarSpa's business-card phone number directly — no human picks up first.
- **Onboard the Customer:** Capture name and service wanted during the call.
- **Send the Booking Link:** Text (SMS, via Synthflow's native post-call action) the Calendly booking link and flyer/menu image immediately after the call.
- **Onboard Employees:** Same phone number also handles new-hire onboarding. Devin asks up front whether the caller is a customer or joining the team, captures name/contact/role for employees, and emails them onboarding info right after the call ends (content TBD from Simon).
- **Track Bookings via Webhook:** Get aware of confirmed bookings through the Calendly `invitee.created` webhook, not by parsing email.
- **Log Everything:** Persist call and booking data to D1 (Cloudflare) and key state back to this GitHub repo.
- **Scale to Multiple Nodes:** Once staff are hired, route bookings via Calendly's native Team/Round Robin event type (requires Calendly Team plan) rather than custom routing logic.
- **Reactivate Past Customers (Later):** Trigger consent-gated outbound Synthflow calls reminding past customers it's been a while — only for customers who gave Simon explicit verbal/in-person consent in advance. No cold outreach.
