export interface Env {
  DB: D1Database;
  CALENDLY_WEBHOOK_SIGNING_KEY?: string;
  SYNTHFLOW_WEBHOOK_TOKEN?: string;
  RESEND_API_KEY?: string;
  ONBOARDING_EMAIL_FROM?: string;
  CALENDLY_BOOKING_URL?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function firstDefined<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Calendly signs webhooks with header `Calendly-Webhook-Signature: t=<ts>,v1=<hex hmac>`,
// HMAC-SHA256 over `${t}.${rawBody}`, keyed with the signing_key returned when the webhook
// subscription is created. docs.calendly.com was unreachable from this build session
// (network policy blocked the host) — re-confirm this once a real subscription exists.
async function verifyCalendlySignature(
  rawBody: string,
  header: string | null,
  signingKey: string
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const expected = await hmacSha256Hex(signingKey, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

// ---------- Synthflow webhook ----------
//
// TODO: confirm exact Synthflow payload field names once the CarSpa agent + its
// information extractors are configured in the Synthflow dashboard. docs.synthflow.ai
// was unreachable from this build session (network policy blocked the host); field
// names below are best-effort per prior confirmed research. raw_payload is always
// stored so nothing is lost if a guess is wrong — reconcile against real payloads
// and tighten these once the agent is live.

interface SynthflowWebhookPayload {
  event?: string;
  call_id?: string;
  id?: string;
  from?: string;
  phone_number?: string;
  caller_number?: string;
  status?: string;
  call_status?: string;
  duration?: number;
  call_duration_seconds?: number;
  transcript?: string;
  call_transcript?: string;
  extracted_variables?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  info_extractor?: Record<string, unknown>;
  [key: string]: unknown;
}

async function handleSynthflowInbound(
  payload: SynthflowWebhookPayload,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Single agent, single number today (Simon is still Node 1 only) — always
  // continue with the agent that received the call. Revisit once multiple
  // Synthflow agents/nodes exist and calls need routing.
  const callId = String(firstDefined(payload.call_id, payload.id) ?? "");
  const phoneNumber = String(firstDefined(payload.from, payload.phone_number, payload.caller_number) ?? "");

  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO calls (call_id, call_type, phone_number, status, raw_payload)
       VALUES (?, 'unknown', ?, 'ringing', ?)
       ON CONFLICT(call_id) DO UPDATE SET phone_number = excluded.phone_number, raw_payload = excluded.raw_payload`
    )
      .bind(callId || crypto.randomUUID(), phoneNumber || null, JSON.stringify(payload))
      .run()
      .catch((err) => console.error("Failed to log inbound call", err))
  );

  // Must respond within Synthflow's ~10s budget. Empty override_model_id = keep
  // the agent that already picked up the call (no reroute).
  return jsonResponse({ call_inbound: { override_model_id: "" } });
}

async function sendEmployeeOnboardingEmail(env: Env, to: string, name: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.ONBOARDING_EMAIL_FROM) {
    console.log(`Onboarding email not sent (no email provider configured yet) — would send to ${to}`);
    return false;
  }
  // Placeholder copy — Simon to provide real onboarding materials (see tasks.md).
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.ONBOARDING_EMAIL_FROM,
      to,
      subject: "Welcome to CarSpa",
      text: `Hi ${name || "there"},\n\nThanks for calling — welcome to the CarSpa team. More onboarding details to follow shortly.\n\n— Devin`,
    }),
  });
  return res.ok;
}

async function handleSynthflowPostCall(
  payload: SynthflowWebhookPayload,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  const callId = String(firstDefined(payload.call_id, payload.id) ?? crypto.randomUUID());
  const phoneNumber = firstDefined(payload.from, payload.phone_number, payload.caller_number);
  const status = firstDefined(payload.status, payload.call_status) ?? "completed";
  const duration = firstDefined(payload.duration, payload.call_duration_seconds) ?? null;
  const transcript = firstDefined(payload.transcript, payload.call_transcript);

  // Devin asks up front on the call whether the caller is a customer or joining
  // the team; that intent should land here via an information extractor field
  // (configured on the Synthflow agent) — assumed key `caller_type` for now.
  const extracted =
    (firstDefined(payload.extracted_variables, payload.variables, payload.info_extractor) as
      | Record<string, unknown>
      | undefined) ?? {};
  const callType = String(extracted.caller_type ?? extracted.call_type ?? "unknown");
  const customerName = firstDefined(extracted.name, extracted.customer_name);
  const serviceRequested = firstDefined(extracted.service_requested, extracted.service);
  const employeeRole = firstDefined(extracted.role, extracted.employee_role);
  const employeeEmail = firstDefined(extracted.email, extracted.employee_email);

  let onboardingEmailSent = false;
  if (callType === "employee" && employeeEmail) {
    try {
      onboardingEmailSent = await sendEmployeeOnboardingEmail(env, String(employeeEmail), String(customerName ?? ""));
    } catch (err) {
      console.error("Failed to send onboarding email", err);
    }
  }

  await env.DB.prepare(
    `INSERT INTO calls (
       call_id, call_type, phone_number, customer_name, service_requested,
       employee_role, employee_email, status, duration_seconds, transcript,
       onboarding_email_sent, raw_payload, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(call_id) DO UPDATE SET
       call_type = excluded.call_type,
       phone_number = excluded.phone_number,
       customer_name = excluded.customer_name,
       service_requested = excluded.service_requested,
       employee_role = excluded.employee_role,
       employee_email = excluded.employee_email,
       status = excluded.status,
       duration_seconds = excluded.duration_seconds,
       transcript = excluded.transcript,
       onboarding_email_sent = excluded.onboarding_email_sent,
       raw_payload = excluded.raw_payload,
       updated_at = datetime('now')`
  )
    .bind(
      callId,
      callType,
      phoneNumber ? String(phoneNumber) : null,
      customerName ? String(customerName) : null,
      serviceRequested ? String(serviceRequested) : null,
      employeeRole ? String(employeeRole) : null,
      employeeEmail ? String(employeeEmail) : null,
      String(status),
      duration,
      transcript ? String(transcript) : null,
      onboardingEmailSent ? 1 : 0,
      JSON.stringify(payload)
    )
    .run();

  return jsonResponse({ ok: true });
}

async function handleSynthflowWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.SYNTHFLOW_WEBHOOK_TOKEN) {
    const url = new URL(request.url);
    if (url.searchParams.get("token") !== env.SYNTHFLOW_WEBHOOK_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: SynthflowWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (payload.event === "call_inbound") {
    return handleSynthflowInbound(payload, env, ctx);
  }
  return handleSynthflowPostCall(payload, env, ctx);
}

// ---------- Calendly webhook ----------
//
// TODO: confirm exact invitee.created/invitee.canceled payload shape once the
// webhook subscription is actually created — this MCP toolset has no
// subscription-creation call, so Simon needs to create it via the Calendly
// dashboard or API and hand back the signing_key. Field names below follow
// Calendly's documented v2 webhook shape from prior training knowledge;
// docs.calendly.com was unreachable from this build session to re-verify.

interface CalendlyWebhookPayload {
  event?: string;
  payload?: {
    uri?: string;
    email?: string;
    name?: string;
    text_reminder_number?: string;
    scheduled_event?: {
      uri?: string;
      start_time?: string;
      event_type?: string;
    };
    event?: { uuid?: string; start_time?: string };
  };
}

async function handleCalendlyWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawBody = await request.text();

  if (env.CALENDLY_WEBHOOK_SIGNING_KEY) {
    const valid = await verifyCalendlySignature(
      rawBody,
      request.headers.get("Calendly-Webhook-Signature"),
      env.CALENDLY_WEBHOOK_SIGNING_KEY
    );
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let body: CalendlyWebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (body.event !== "invitee.created" && body.event !== "invitee.canceled") {
    return jsonResponse({ ok: true, skipped: body.event ?? "unknown" });
  }

  const p = body.payload ?? {};
  const eventUri = String(firstDefined(p.uri, p.scheduled_event?.uri, p.event?.uuid) ?? crypto.randomUUID());
  const startTime = firstDefined(p.scheduled_event?.start_time, p.event?.start_time) ?? null;
  const status = body.event === "invitee.canceled" ? "canceled" : "active";

  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO bookings (calendly_event_uri, invitee_name, invitee_email, invitee_phone, event_start_time, event_type_uri, status, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(calendly_event_uri) DO UPDATE SET status = excluded.status, raw_payload = excluded.raw_payload`
    )
      .bind(
        eventUri,
        p.name ?? null,
        p.email ?? null,
        p.text_reminder_number ?? null,
        startTime,
        p.scheduled_event?.event_type ?? null,
        status,
        rawBody
      )
      .run()
      .catch((err) => console.error("Failed to log booking", err))
  );

  return jsonResponse({ ok: true });
}

// ---------- Router ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/synthflow-webhook") {
      return handleSynthflowWebhook(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/calendly-webhook") {
      return handleCalendlyWebhook(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
