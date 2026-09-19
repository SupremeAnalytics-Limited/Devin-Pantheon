import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  PAYSTACK_SECRET_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Builds a query string from a params object, dropping undefined/null/empty values. */
function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Drops undefined/null/empty-string entries so optional params aren't sent as null. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

async function paystackRequest(
  env: Env,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<unknown> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured. Set it with `wrangler secret put PAYSTACK_SECRET_KEY`."
    );
  }

  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const message =
      (json as { message?: string } | null)?.message ?? res.statusText ?? "Unknown error";
    throw new Error(`Paystack API error (HTTP ${res.status}): ${message}`);
  }

  return json;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

/** Wraps a Paystack call so every tool returns clean JSON on success or on error. */
async function runTool(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return toolResult(data);
  } catch (err) {
    return errorResult(err);
  }
}

export class PaystackMCP extends McpAgent<Env> {
  server = new McpServer({ name: "paystack-mcp", version: "2.0.0" });

  async init() {
    const env = this.env;
    const get = (path: string) => paystackRequest(env, "GET", path);
    const post = (path: string, body?: unknown) => paystackRequest(env, "POST", path, body);
    const put = (path: string, body?: unknown) => paystackRequest(env, "PUT", path, body);
    const del = (path: string, body?: unknown) => paystackRequest(env, "DELETE", path, body);
    const tool = this.server.tool.bind(this.server);

    // ---------------------------------------------------------------------
    // Transactions
    // ---------------------------------------------------------------------

    tool(
      "get_balance",
      "Fetch the current Paystack account balance across all supported currencies.",
      {},
      async () => runTool(() => get("/balance"))
    );

    tool(
      "initialize_transaction",
      "Initialize a new Paystack transaction and get an authorization URL for the customer to pay.",
      {
        email: z.string().describe("Customer's email address"),
        amount: z.number().positive().describe("Amount in the smallest currency unit (e.g. kobo for NGN)"),
        currency: z.string().optional(),
        reference: z.string().optional().describe("Unique transaction reference; auto-generated if omitted"),
        callback_url: z.string().optional(),
        plan: z.string().optional().describe("Plan code, to charge a subscription"),
        invoice_limit: z.number().int().optional(),
        metadata: z.record(z.any()).optional(),
        channels: z
          .array(z.enum(["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer", "eft"]))
          .optional(),
        split_code: z.string().optional(),
        subaccount: z.string().optional(),
        transaction_charge: z.number().optional(),
        bearer: z.enum(["account", "subaccount"]).optional(),
      },
      async (params) => runTool(() => post("/transaction/initialize", compact(params)))
    );

    tool(
      "list_transactions",
      "List Paystack transactions, optionally filtered by date range, status, or customer.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional().describe("Start date, ISO 8601"),
        to: z.string().optional().describe("End date, ISO 8601"),
        status: z.enum(["failed", "success", "abandoned"]).optional(),
        customer: z.union([z.string(), z.number()]).optional(),
      },
      async (params) => runTool(() => get(`/transaction${toQueryString(compact(params))}`))
    );

    tool(
      "get_transaction",
      "Fetch a single transaction by its numeric ID or its reference string.",
      { id_or_reference: z.string().describe("Numeric Paystack transaction ID, or the transaction reference") },
      async ({ id_or_reference }) =>
        runTool(() => {
          const isNumericId = /^\d+$/.test(id_or_reference);
          return get(
            isNumericId ? `/transaction/${id_or_reference}` : `/transaction/verify/${encodeURIComponent(id_or_reference)}`
          );
        })
    );

    tool(
      "verify_transaction",
      "Verify the status of a transaction by its reference (confirms whether payment succeeded).",
      { reference: z.string() },
      async ({ reference }) => runTool(() => get(`/transaction/verify/${encodeURIComponent(reference)}`))
    );

    tool(
      "charge_authorization",
      "Charge a previously authorized card (reusable authorization_code) without customer interaction.",
      {
        email: z.string(),
        amount: z.number().positive(),
        authorization_code: z.string(),
        reference: z.string().optional(),
        currency: z.string().optional(),
        metadata: z.record(z.any()).optional(),
        channels: z.array(z.string()).optional(),
        subaccount: z.string().optional(),
        transaction_charge: z.number().optional(),
        bearer: z.enum(["account", "subaccount"]).optional(),
        queue: z.boolean().optional(),
      },
      async (params) => runTool(() => post("/transaction/charge_authorization", compact(params)))
    );

    tool(
      "view_transaction_timeline",
      "Fetch the timeline of events for a transaction by its ID or reference.",
      { id_or_reference: z.string() },
      async ({ id_or_reference }) => runTool(() => get(`/transaction/timeline/${encodeURIComponent(id_or_reference)}`))
    );

    tool(
      "get_transaction_totals",
      "Fetch total amount received across all successful transactions.",
      {
        perPage: z.number().int().positive().optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/transaction/totals${toQueryString(compact(params))}`))
    );

    tool(
      "export_transactions",
      "Request a CSV export of transactions matching the given filters.",
      {
        perPage: z.number().int().positive().optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        customer: z.union([z.string(), z.number()]).optional(),
        status: z.enum(["failed", "success", "abandoned"]).optional(),
        currency: z.string().optional(),
        settled: z.boolean().optional(),
        settlement: z.number().optional(),
        payment_page: z.number().optional(),
      },
      async (params) => runTool(() => get(`/transaction/export${toQueryString(compact(params))}`))
    );

    tool(
      "partial_debit",
      "Retrieve part of the funds available on a customer's reusable authorization.",
      {
        authorization_code: z.string(),
        currency: z.string(),
        amount: z.number().positive(),
        email: z.string(),
        reference: z.string().optional(),
        at_least: z.string().optional().describe("Minimum amount to debit if full amount unavailable"),
      },
      async (params) => runTool(() => post("/transaction/partial_debit", compact(params)))
    );

    // ---------------------------------------------------------------------
    // Transaction Splits
    // ---------------------------------------------------------------------

    tool(
      "create_split",
      "Create a payment split configuration that divides transaction proceeds between subaccounts.",
      {
        name: z.string(),
        type: z.enum(["percentage", "flat"]),
        currency: z.string().optional().default("NGN"),
        subaccounts: z.array(z.object({ subaccount: z.string(), share: z.number().positive() })).min(1),
        bearer_type: z.enum(["subaccount", "account", "all-proportional", "all"]).optional(),
        bearer_subaccount: z.string().optional(),
      },
      async (params) => runTool(() => post("/split", compact(params)))
    );

    tool(
      "list_splits",
      "List all payment split configurations on the account.",
      {
        name: z.string().optional(),
        active: z.boolean().optional(),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async (params) => runTool(() => get(`/split${toQueryString(compact(params))}`))
    );

    tool(
      "get_split",
      "Fetch a single payment split configuration by ID.",
      { split_id: z.string() },
      async ({ split_id }) => runTool(() => get(`/split/${encodeURIComponent(split_id)}`))
    );

    tool(
      "update_split",
      "Update a payment split's name, active status, or bearer settings.",
      {
        split_id: z.string(),
        name: z.string().optional(),
        active: z.boolean().optional(),
        bearer_type: z.enum(["subaccount", "account", "all-proportional", "all"]).optional(),
        bearer_subaccount: z.string().optional(),
      },
      async ({ split_id, ...rest }) => runTool(() => put(`/split/${encodeURIComponent(split_id)}`, compact(rest)))
    );

    tool(
      "add_split_subaccount",
      "Add a subaccount (with its share) to an existing payment split.",
      { split_id: z.string(), subaccount: z.string(), share: z.number().positive() },
      async ({ split_id, ...rest }) => runTool(() => post(`/split/${encodeURIComponent(split_id)}/subaccount/add`, rest))
    );

    tool(
      "remove_split_subaccount",
      "Remove a subaccount from an existing payment split.",
      { split_id: z.string(), subaccount: z.string() },
      async ({ split_id, subaccount }) =>
        runTool(() => post(`/split/${encodeURIComponent(split_id)}/subaccount/remove`, { subaccount }))
    );

    // ---------------------------------------------------------------------
    // Customers
    // ---------------------------------------------------------------------

    tool(
      "list_customers",
      "List all customers.",
      { perPage: z.number().int().positive().max(100).optional(), page: z.number().int().positive().optional() },
      async (params) => runTool(() => get(`/customer${toQueryString(compact(params))}`))
    );

    tool(
      "get_customer",
      "Fetch a single customer by email or customer code.",
      { email_or_code: z.string() },
      async ({ email_or_code }) => runTool(() => get(`/customer/${encodeURIComponent(email_or_code)}`))
    );

    tool(
      "create_customer",
      "Create a new customer.",
      {
        email: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      },
      async (params) => runTool(() => post("/customer", compact(params)))
    );

    tool(
      "update_customer",
      "Update an existing customer's details.",
      {
        code: z.string().describe("Customer code"),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      },
      async ({ code, ...rest }) => runTool(() => put(`/customer/${encodeURIComponent(code)}`, compact(rest)))
    );

    tool(
      "validate_customer",
      "Validate a customer's identity for compliance purposes (e.g. before higher transaction limits).",
      {
        code: z.string().describe("Customer code"),
        country: z.string(),
        type: z.string().describe("Identification type, e.g. bank_account"),
        account_number: z.string(),
        bvn: z.string(),
        bank_code: z.string(),
        first_name: z.string(),
        last_name: z.string(),
      },
      async ({ code, ...rest }) => runTool(() => post(`/customer/${encodeURIComponent(code)}/identification`, rest))
    );

    tool(
      "set_customer_risk_action",
      "Whitelist or blacklist a customer.",
      { customer: z.string().describe("Customer code or email"), risk_action: z.enum(["default", "allow", "deny"]) },
      async (params) => runTool(() => post("/customer/set_risk_action", params))
    );

    tool(
      "deactivate_authorization",
      "Deactivate a customer's reusable card authorization.",
      { authorization_code: z.string() },
      async (params) => runTool(() => post("/customer/deactivate_authorization", params))
    );

    // ---------------------------------------------------------------------
    // Dedicated Virtual Accounts
    // ---------------------------------------------------------------------

    tool(
      "create_dedicated_account",
      "Create a dedicated virtual bank account for a customer.",
      {
        customer: z.string().describe("Customer ID or code"),
        preferred_bank: z.string().optional(),
        subaccount: z.string().optional(),
        split_code: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
      },
      async (params) => runTool(() => post("/dedicated_account", compact(params)))
    );

    tool(
      "assign_dedicated_account",
      "Create a customer, validate them, and assign a dedicated virtual account in one call.",
      {
        email: z.string(),
        first_name: z.string(),
        last_name: z.string(),
        phone: z.string(),
        preferred_bank: z.string(),
        country: z.string().optional().default("NG"),
        account_number: z.string().optional(),
        bvn: z.string().optional(),
        bank_code: z.string().optional(),
        subaccount: z.string().optional(),
        split_code: z.string().optional(),
      },
      async (params) => runTool(() => post("/dedicated_account/assign", compact(params)))
    );

    tool(
      "list_dedicated_accounts",
      "List dedicated virtual accounts.",
      {
        active: z.boolean().optional(),
        currency: z.string().optional(),
        provider_slug: z.string().optional(),
        bank_id: z.string().optional(),
        customer: z.string().optional(),
      },
      async (params) => runTool(() => get(`/dedicated_account${toQueryString(compact(params))}`))
    );

    tool(
      "get_dedicated_account",
      "Fetch a single dedicated virtual account by ID.",
      { dedicated_account_id: z.string() },
      async ({ dedicated_account_id }) => runTool(() => get(`/dedicated_account/${encodeURIComponent(dedicated_account_id)}`))
    );

    tool(
      "deactivate_dedicated_account",
      "Deactivate a dedicated virtual account.",
      { dedicated_account_id: z.string() },
      async ({ dedicated_account_id }) => runTool(() => del(`/dedicated_account/${encodeURIComponent(dedicated_account_id)}`))
    );

    tool(
      "split_dedicated_account",
      "Split a dedicated virtual account's incoming transactions with a subaccount or split.",
      { customer: z.string(), subaccount: z.string().optional(), split_code: z.string().optional() },
      async (params) => runTool(() => post("/dedicated_account/split", compact(params)))
    );

    tool(
      "remove_dedicated_account_split",
      "Remove the split configuration from a dedicated virtual account.",
      { account_number: z.string() },
      async (params) => runTool(() => del("/dedicated_account/split", params))
    );

    tool(
      "list_dedicated_account_providers",
      "List banks that support dedicated virtual accounts.",
      {},
      async () => runTool(() => get("/dedicated_account/available_providers"))
    );

    // ---------------------------------------------------------------------
    // Subaccounts
    // ---------------------------------------------------------------------

    tool(
      "create_subaccount",
      "Create a subaccount to split transaction settlements with (e.g. a vendor or partner).",
      {
        business_name: z.string(),
        settlement_bank: z.string().describe("Bank code"),
        account_number: z.string(),
        percentage_charge: z.number().describe("Percentage of each transaction that belongs to the subaccount"),
        description: z.string().optional(),
        primary_contact_email: z.string().optional(),
        primary_contact_name: z.string().optional(),
        primary_contact_phone: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      },
      async (params) => runTool(() => post("/subaccount", compact(params)))
    );

    tool(
      "list_subaccounts",
      "List all subaccounts.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/subaccount${toQueryString(compact(params))}`))
    );

    tool(
      "get_subaccount",
      "Fetch a single subaccount by ID or code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/subaccount/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "update_subaccount",
      "Update a subaccount's details.",
      {
        id_or_code: z.string(),
        business_name: z.string().optional(),
        settlement_bank: z.string().optional(),
        account_number: z.string().optional(),
        active: z.boolean().optional(),
        percentage_charge: z.number().optional(),
        description: z.string().optional(),
        primary_contact_email: z.string().optional(),
        primary_contact_name: z.string().optional(),
        primary_contact_phone: z.string().optional(),
        settlement_schedule: z.enum(["auto", "weekly", "monthly", "manual"]).optional(),
        metadata: z.record(z.any()).optional(),
      },
      async ({ id_or_code, ...rest }) => runTool(() => put(`/subaccount/${encodeURIComponent(id_or_code)}`, compact(rest)))
    );

    // ---------------------------------------------------------------------
    // Plans & Subscriptions
    // ---------------------------------------------------------------------

    tool(
      "create_plan",
      "Create a subscription plan.",
      {
        name: z.string(),
        amount: z.number().positive(),
        interval: z.enum(["daily", "weekly", "monthly", "biannually", "annually", "quarterly"]),
        description: z.string().optional(),
        send_invoices: z.boolean().optional(),
        send_sms: z.boolean().optional(),
        currency: z.string().optional(),
        invoice_limit: z.number().int().optional(),
      },
      async (params) => runTool(() => post("/plan", compact(params)))
    );

    tool(
      "list_plans",
      "List all subscription plans.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        status: z.string().optional(),
        interval: z.string().optional(),
        amount: z.number().optional(),
      },
      async (params) => runTool(() => get(`/plan${toQueryString(compact(params))}`))
    );

    tool(
      "get_plan",
      "Fetch a single subscription plan by ID or code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/plan/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "update_plan",
      "Update a subscription plan.",
      {
        id_or_code: z.string(),
        name: z.string().optional(),
        amount: z.number().optional(),
        interval: z.string().optional(),
        description: z.string().optional(),
        send_invoices: z.boolean().optional(),
        send_sms: z.boolean().optional(),
        currency: z.string().optional(),
      },
      async ({ id_or_code, ...rest }) => runTool(() => put(`/plan/${encodeURIComponent(id_or_code)}`, compact(rest)))
    );

    tool(
      "create_subscription",
      "Subscribe a customer to a plan.",
      {
        customer: z.string().describe("Customer email or code"),
        plan: z.string().describe("Plan code"),
        authorization: z.string().optional().describe("Authorization code to charge; defaults to most recent"),
        start_date: z.string().optional(),
      },
      async (params) => runTool(() => post("/subscription", compact(params)))
    );

    tool(
      "list_subscriptions",
      "List all subscriptions.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        customer: z.string().optional(),
        plan: z.string().optional(),
      },
      async (params) => runTool(() => get(`/subscription${toQueryString(compact(params))}`))
    );

    tool(
      "get_subscription",
      "Fetch a single subscription by ID or code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/subscription/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "enable_subscription",
      "Enable (reactivate) a subscription.",
      { code: z.string(), token: z.string().describe("Subscription's email token") },
      async (params) => runTool(() => post("/subscription/enable", params))
    );

    tool(
      "disable_subscription",
      "Disable (cancel) a subscription.",
      { code: z.string(), token: z.string().describe("Subscription's email token") },
      async (params) => runTool(() => post("/subscription/disable", params))
    );

    tool(
      "generate_subscription_update_link",
      "Generate a link the customer can use to update their subscription's card.",
      { code: z.string() },
      async ({ code }) => runTool(() => get(`/subscription/${encodeURIComponent(code)}/manage/link`))
    );

    tool(
      "send_subscription_update_link",
      "Email the customer a link to update their subscription's card.",
      { code: z.string() },
      async ({ code }) => runTool(() => post(`/subscription/${encodeURIComponent(code)}/manage/email`))
    );

    // ---------------------------------------------------------------------
    // Products & Payment Pages
    // ---------------------------------------------------------------------

    tool(
      "create_product",
      "Create a sellable product.",
      {
        name: z.string(),
        description: z.string(),
        price: z.number().positive(),
        currency: z.string(),
        unlimited: z.boolean().optional(),
        quantity: z.number().int().optional(),
      },
      async (params) => runTool(() => post("/product", compact(params)))
    );

    tool(
      "list_products",
      "List all products.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/product${toQueryString(compact(params))}`))
    );

    tool(
      "get_product",
      "Fetch a single product by ID.",
      { id: z.string() },
      async ({ id }) => runTool(() => get(`/product/${encodeURIComponent(id)}`))
    );

    tool(
      "update_product",
      "Update a product's details.",
      {
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        price: z.number().optional(),
        currency: z.string().optional(),
        unlimited: z.boolean().optional(),
        quantity: z.number().int().optional(),
      },
      async ({ id, ...rest }) => runTool(() => put(`/product/${encodeURIComponent(id)}`, compact(rest)))
    );

    tool(
      "create_payment_page",
      "Create a hosted payment page.",
      {
        name: z.string(),
        description: z.string().optional(),
        amount: z.number().positive().optional(),
        split_code: z.string().optional(),
        metadata: z.record(z.any()).optional(),
        redirect_url: z.string().optional(),
        slug: z.string().optional(),
        type: z.string().optional(),
      },
      async (params) => runTool(() => post("/page", compact(params)))
    );

    tool(
      "list_payment_pages",
      "List all payment pages.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/page${toQueryString(compact(params))}`))
    );

    tool(
      "get_payment_page",
      "Fetch a single payment page by ID or slug.",
      { id_or_slug: z.string() },
      async ({ id_or_slug }) => runTool(() => get(`/page/${encodeURIComponent(id_or_slug)}`))
    );

    tool(
      "update_payment_page",
      "Update a payment page.",
      {
        id_or_slug: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        amount: z.number().optional(),
        active: z.boolean().optional(),
      },
      async ({ id_or_slug, ...rest }) => runTool(() => put(`/page/${encodeURIComponent(id_or_slug)}`, compact(rest)))
    );

    tool(
      "check_payment_page_slug",
      "Check whether a payment page slug is available.",
      { slug: z.string() },
      async ({ slug }) => runTool(() => get(`/page/check_slug_availability/${encodeURIComponent(slug)}`))
    );

    tool(
      "add_products_to_page",
      "Add a product to a payment page.",
      { id: z.string(), product: z.array(z.string()).describe("Product IDs to add") },
      async ({ id, product }) => runTool(() => post(`/page/${encodeURIComponent(id)}/product`, { product }))
    );

    // ---------------------------------------------------------------------
    // Invoices (Payment Requests)
    // ---------------------------------------------------------------------

    tool(
      "create_invoice",
      "Create and send an invoice (payment request) to a customer.",
      {
        customer: z.string().describe("Customer ID or code"),
        amount: z.number().positive().optional(),
        due_date: z.string().optional(),
        description: z.string().optional(),
        line_items: z.array(z.object({ name: z.string(), amount: z.number(), quantity: z.number().optional() })).optional(),
        tax: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
        currency: z.string().optional(),
        send_notification: z.boolean().optional(),
        draft: z.boolean().optional(),
        invoice_number: z.number().int().optional(),
        split_code: z.string().optional(),
      },
      async (params) => runTool(() => post("/paymentrequest", compact(params)))
    );

    tool(
      "list_invoices",
      "List all invoices (payment requests).",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        customer: z.string().optional(),
        status: z.string().optional(),
        currency: z.string().optional(),
        include_archive: z.boolean().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/paymentrequest${toQueryString(compact(params))}`))
    );

    tool(
      "get_invoice",
      "Fetch a single invoice by ID or code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/paymentrequest/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "verify_invoice",
      "Verify an invoice's details and payment status by its code.",
      { code: z.string() },
      async ({ code }) => runTool(() => get(`/paymentrequest/verify/${encodeURIComponent(code)}`))
    );

    tool(
      "send_invoice_notification",
      "Re-send notification for an invoice.",
      { id: z.string() },
      async ({ id }) => runTool(() => post(`/paymentrequest/notify/${encodeURIComponent(id)}`))
    );

    tool(
      "get_invoice_totals",
      "Fetch total amounts due, paid, and overdue across all invoices.",
      {},
      async () => runTool(() => get("/paymentrequest/totals"))
    );

    tool(
      "finalize_invoice",
      "Finalize a draft invoice, turning it into a payable one.",
      { id: z.string() },
      async ({ id }) => runTool(() => post(`/paymentrequest/finalize/${encodeURIComponent(id)}`))
    );

    tool(
      "update_invoice",
      "Update a draft invoice.",
      {
        id: z.string(),
        customer: z.string().optional(),
        amount: z.number().optional(),
        due_date: z.string().optional(),
        description: z.string().optional(),
        line_items: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
        tax: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
      },
      async ({ id, ...rest }) => runTool(() => put(`/paymentrequest/${encodeURIComponent(id)}`, compact(rest)))
    );

    tool(
      "archive_invoice",
      "Archive an invoice.",
      { id: z.string() },
      async ({ id }) => runTool(() => post(`/paymentrequest/archive/${encodeURIComponent(id)}`))
    );

    // ---------------------------------------------------------------------
    // Settlements
    // ---------------------------------------------------------------------

    tool(
      "list_settlements",
      "Fetch all settlements paid out to the Paystack account.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/settlement${toQueryString(compact(params))}`))
    );

    tool(
      "get_settlement_transactions",
      "Fetch the transactions that make up a specific settlement.",
      {
        settlement_id: z.string(),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async ({ settlement_id, ...rest }) =>
        runTool(() => get(`/settlement/${encodeURIComponent(settlement_id)}/transactions${toQueryString(compact(rest))}`))
    );

    // ---------------------------------------------------------------------
    // Transfer Recipients
    // ---------------------------------------------------------------------

    tool(
      "create_transfer_recipient",
      "Create a transfer recipient (bank account) that money can later be sent to.",
      {
        name: z.string(),
        account_number: z.string(),
        bank_code: z.string(),
        currency: z.string().optional().default("NGN"),
        type: z.string().optional().default("nuban"),
        description: z.string().optional(),
      },
      async (params) => runTool(() => post("/transferrecipient", compact(params)))
    );

    tool(
      "bulk_create_transfer_recipients",
      "Create multiple transfer recipients in one call.",
      {
        batch: z
          .array(
            z.object({
              type: z.string().default("nuban"),
              name: z.string(),
              account_number: z.string(),
              bank_code: z.string(),
              currency: z.string().optional(),
            })
          )
          .min(1),
      },
      async ({ batch }) => runTool(() => post("/transferrecipient/bulk", { batch }))
    );

    tool(
      "list_recipients",
      "List all transfer recipients configured on the account.",
      { perPage: z.number().int().positive().max(100).optional(), page: z.number().int().positive().optional() },
      async (params) => runTool(() => get(`/transferrecipient${toQueryString(compact(params))}`))
    );

    tool(
      "get_transfer_recipient",
      "Fetch a single transfer recipient by ID or code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/transferrecipient/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "update_transfer_recipient",
      "Update a transfer recipient's name or email.",
      { id_or_code: z.string(), name: z.string().optional(), email: z.string().optional() },
      async ({ id_or_code, ...rest }) =>
        runTool(() => put(`/transferrecipient/${encodeURIComponent(id_or_code)}`, compact(rest)))
    );

    tool(
      "delete_transfer_recipient",
      "Delete (deactivate) a transfer recipient.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => del(`/transferrecipient/${encodeURIComponent(id_or_code)}`))
    );

    // ---------------------------------------------------------------------
    // Transfers
    // ---------------------------------------------------------------------

    tool(
      "initiate_transfer",
      "Send money from the Paystack balance to a transfer recipient.",
      {
        recipient_code: z.string(),
        amount: z.number().positive().describe("Amount in the smallest currency unit"),
        reason: z.string().optional(),
        currency: z.string().optional(),
        reference: z.string().optional(),
      },
      async ({ recipient_code, ...rest }) =>
        runTool(() => post("/transfer", { source: "balance", recipient: recipient_code, ...compact(rest) }))
    );

    tool(
      "bulk_transfer",
      "Initiate multiple transfers to different recipients in a single batch.",
      {
        currency: z.string().optional(),
        transfers: z
          .array(
            z.object({
              amount: z.number().positive(),
              recipient: z.string(),
              reason: z.string().optional(),
              reference: z.string().optional(),
            })
          )
          .min(1),
      },
      async ({ currency, transfers }) => runTool(() => post("/transfer/bulk", compact({ source: "balance", currency, transfers })))
    );

    tool(
      "get_transfer",
      "Fetch the status and details of a specific transfer by its ID or transfer code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/transfer/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "list_transfers",
      "List all transfers, optionally filtered by status or date range.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        status: z.enum(["failed", "success", "reversed", "pending", "otp"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      async (params) => runTool(() => get(`/transfer${toQueryString(compact(params))}`))
    );

    tool(
      "finalize_transfer",
      "Finalize a transfer that requires OTP confirmation.",
      { transfer_code: z.string(), otp: z.string() },
      async (params) => runTool(() => post("/transfer/finalize_transfer", params))
    );

    tool(
      "verify_transfer",
      "Verify a transfer's status by its reference.",
      { reference: z.string() },
      async ({ reference }) => runTool(() => get(`/transfer/verify/${encodeURIComponent(reference)}`))
    );

    tool(
      "fetch_balance_ledger",
      "Fetch the history of balance movements (debits/credits) on the account.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async (params) => runTool(() => get(`/balance/ledger${toQueryString(compact(params))}`))
    );

    tool(
      "resend_transfer_otp",
      "Resend the OTP for a pending transfer.",
      { transfer_code: z.string(), reason: z.enum(["resend_otp", "transfer"]) },
      async (params) => runTool(() => post("/transfer/resend_otp", params))
    );

    tool(
      "disable_transfer_otp",
      "Request disabling OTP requirement for transfers (sends OTP to confirm the change).",
      {},
      async () => runTool(() => post("/transfer/disable_otp"))
    );

    tool(
      "enable_transfer_otp",
      "Re-enable OTP requirement for transfers.",
      {},
      async () => runTool(() => post("/transfer/enable_otp"))
    );

    tool(
      "finalize_disable_transfer_otp",
      "Confirm disabling OTP requirement for transfers using the OTP sent to your email.",
      { otp: z.string() },
      async (params) => runTool(() => post("/transfer/disable_otp_finalize", params))
    );

    // ---------------------------------------------------------------------
    // Bulk Charges
    // ---------------------------------------------------------------------

    tool(
      "initiate_bulk_charge",
      "Charge multiple customers' saved authorizations in one batch.",
      {
        charges: z.array(z.object({ authorization: z.string(), amount: z.number().positive(), reference: z.string().optional() })).min(1),
      },
      async ({ charges }) => runTool(() => post("/bulkcharge", charges))
    );

    tool(
      "list_bulk_charges",
      "List all bulk charge batches.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.string().optional(),
      },
      async (params) => runTool(() => get(`/bulkcharge${toQueryString(compact(params))}`))
    );

    tool(
      "get_bulk_charge",
      "Fetch a bulk charge batch by ID or code.",
      { id_or_code: z.string() },
      async ({ id_or_code }) => runTool(() => get(`/bulkcharge/${encodeURIComponent(id_or_code)}`))
    );

    tool(
      "pause_bulk_charge",
      "Pause processing of a bulk charge batch.",
      { batch_code: z.string() },
      async ({ batch_code }) => runTool(() => get(`/bulkcharge/pause/${encodeURIComponent(batch_code)}`))
    );

    tool(
      "resume_bulk_charge",
      "Resume processing of a paused bulk charge batch.",
      { batch_code: z.string() },
      async ({ batch_code }) => runTool(() => get(`/bulkcharge/resume/${encodeURIComponent(batch_code)}`))
    );

    tool(
      "list_bulk_charge_units",
      "List the individual charges within a bulk charge batch.",
      {
        id_or_code: z.string(),
        status: z.enum(["pending", "success", "failed"]).optional(),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async ({ id_or_code, ...rest }) =>
        runTool(() => get(`/bulkcharge/${encodeURIComponent(id_or_code)}/charges${toQueryString(compact(rest))}`))
    );

    // ---------------------------------------------------------------------
    // Direct Charge
    // ---------------------------------------------------------------------

    tool(
      "create_charge",
      "Charge a customer directly (card, bank, USSD, mobile money, or bank transfer) without a hosted redirect.",
      {
        email: z.string(),
        amount: z.number().positive(),
        authorization_code: z.string().optional(),
        pin: z.string().optional(),
        reference: z.string().optional(),
        metadata: z.record(z.any()).optional(),
        bank: z.record(z.any()).optional().describe("e.g. { code, account_number }"),
        bank_transfer: z.record(z.any()).optional(),
        ussd: z.record(z.any()).optional().describe("e.g. { type: '737' }"),
        mobile_money: z.record(z.any()).optional(),
        device_id: z.string().optional(),
      },
      async (params) => runTool(() => post("/charge", compact(params)))
    );

    tool("submit_pin", "Submit a card PIN to continue a pending charge.", { pin: z.string(), reference: z.string() }, async (params) =>
      runTool(() => post("/charge/submit_pin", params))
    );

    tool("submit_otp", "Submit an OTP to continue a pending charge.", { otp: z.string(), reference: z.string() }, async (params) =>
      runTool(() => post("/charge/submit_otp", params))
    );

    tool(
      "submit_phone",
      "Submit a phone number to continue a pending charge.",
      { phone: z.string(), reference: z.string() },
      async (params) => runTool(() => post("/charge/submit_phone", params))
    );

    tool(
      "submit_birthday",
      "Submit a birthday to continue a pending charge.",
      { birthday: z.string().describe("YYYY-MM-DD"), reference: z.string() },
      async (params) => runTool(() => post("/charge/submit_birthday", params))
    );

    tool(
      "submit_address",
      "Submit an address to continue a pending charge.",
      { address: z.string(), reference: z.string(), city: z.string(), state: z.string(), zipcode: z.string() },
      async (params) => runTool(() => post("/charge/submit_address", params))
    );

    tool(
      "check_pending_charge",
      "Check the status of a charge that is still pending.",
      { reference: z.string() },
      async ({ reference }) => runTool(() => get(`/charge/${encodeURIComponent(reference)}`))
    );

    // ---------------------------------------------------------------------
    // Disputes
    // ---------------------------------------------------------------------

    tool(
      "list_disputes",
      "List disputes (chargebacks) filed against transactions.",
      {
        from: z.string().optional(),
        to: z.string().optional(),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        transaction: z.string().optional(),
        status: z.string().optional(),
      },
      async (params) => runTool(() => get(`/dispute${toQueryString(compact(params))}`))
    );

    tool(
      "get_dispute",
      "Fetch a single dispute by ID.",
      { id: z.string() },
      async ({ id }) => runTool(() => get(`/dispute/${encodeURIComponent(id)}`))
    );

    tool(
      "list_transaction_disputes",
      "List disputes filed against a specific transaction.",
      { transaction_id: z.string() },
      async ({ transaction_id }) => runTool(() => get(`/dispute/transaction/${encodeURIComponent(transaction_id)}`))
    );

    tool(
      "update_dispute",
      "Update a dispute with a refund amount and/or uploaded evidence filename.",
      { id: z.string(), refund_amount: z.number(), uploaded_filename: z.string().optional() },
      async ({ id, ...rest }) => runTool(() => put(`/dispute/${encodeURIComponent(id)}`, compact(rest)))
    );

    tool(
      "add_dispute_evidence",
      "Submit evidence for a dispute.",
      {
        id: z.string(),
        customer_email: z.string(),
        customer_name: z.string(),
        customer_phone: z.string(),
        service_details: z.string(),
        delivery_address: z.string().optional(),
        delivery_date: z.string().optional(),
      },
      async ({ id, ...rest }) => runTool(() => post(`/dispute/${encodeURIComponent(id)}/evidence`, compact(rest)))
    );

    tool(
      "get_dispute_upload_url",
      "Get a signed URL to upload a file as dispute evidence.",
      { id: z.string(), upload_filename: z.string() },
      async ({ id, upload_filename }) =>
        runTool(() => get(`/dispute/${encodeURIComponent(id)}/upload_url${toQueryString({ upload_filename })}`))
    );

    tool(
      "resolve_dispute",
      "Resolve a dispute.",
      {
        id: z.string(),
        resolution: z.enum(["merchant-accepted", "declined"]),
        message: z.string(),
        refund_amount: z.number(),
        uploaded_filename: z.string(),
        evidence: z.number().optional().describe("Evidence ID, if previously submitted"),
      },
      async ({ id, ...rest }) => runTool(() => put(`/dispute/${encodeURIComponent(id)}/resolve`, compact(rest)))
    );

    tool(
      "export_disputes",
      "Request a CSV export of disputes.",
      {
        from: z.string().optional(),
        to: z.string().optional(),
        perPage: z.number().int().positive().optional(),
        page: z.number().int().positive().optional(),
        transaction: z.string().optional(),
        status: z.string().optional(),
      },
      async (params) => runTool(() => get(`/dispute/export${toQueryString(compact(params))}`))
    );

    // ---------------------------------------------------------------------
    // Refunds
    // ---------------------------------------------------------------------

    tool(
      "create_refund",
      "Initiate a refund for a transaction.",
      {
        transaction: z.string().describe("Transaction ID or reference"),
        amount: z.number().positive().optional().describe("Omit to refund in full"),
        currency: z.string().optional(),
        customer_note: z.string().optional(),
        merchant_note: z.string().optional(),
      },
      async (params) => runTool(() => post("/refund", compact(params)))
    );

    tool(
      "list_refunds",
      "List all refunds.",
      {
        reference: z.string().optional(),
        currency: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async (params) => runTool(() => get(`/refund${toQueryString(compact(params))}`))
    );

    tool(
      "get_refund",
      "Fetch a single refund by ID.",
      { id: z.string() },
      async ({ id }) => runTool(() => get(`/refund/${encodeURIComponent(id)}`))
    );

    // ---------------------------------------------------------------------
    // Verification & Miscellaneous
    // ---------------------------------------------------------------------

    tool(
      "resolve_account_number",
      "Resolve a bank account number to its account holder name.",
      { account_number: z.string(), bank_code: z.string() },
      async (params) => runTool(() => get(`/bank/resolve${toQueryString(params)}`))
    );

    tool(
      "validate_account",
      "Validate a customer's bank account for a specific country (e.g. South Africa) via KYC document.",
      {
        account_name: z.string(),
        account_number: z.string(),
        account_type: z.enum(["personal", "business"]),
        bank_code: z.string(),
        country_code: z.string(),
        document_type: z.string(),
        document_number: z.string().optional(),
      },
      async (params) => runTool(() => post("/bank/validate", compact(params)))
    );

    tool(
      "resolve_card_bin",
      "Look up card scheme, type, and issuing bank from the first 6 digits of a card (BIN).",
      { bin: z.string() },
      async ({ bin }) => runTool(() => get(`/decision/bin/${encodeURIComponent(bin)}`))
    );

    tool(
      "list_banks",
      "List banks supported by Paystack, optionally filtered by country or currency.",
      {
        country: z.string().optional(),
        use_cursor: z.boolean().optional(),
        perPage: z.number().int().positive().optional(),
        currency: z.string().optional(),
        type: z.string().optional(),
      },
      async (params) => runTool(() => get(`/bank${toQueryString(compact(params))}`))
    );

    tool("list_countries", "List countries supported by Paystack.", {}, async () => runTool(() => get("/country")));

    tool(
      "list_states",
      "List states/provinces for a country (used for address verification, e.g. Kenya, South Africa).",
      { country: z.string() },
      async ({ country }) => runTool(() => get(`/address_verification/states${toQueryString({ country })}`))
    );

    // ---------------------------------------------------------------------
    // Apple Pay
    // ---------------------------------------------------------------------

    tool(
      "register_apple_pay_domain",
      "Register a domain for Apple Pay.",
      { domainName: z.string() },
      async (params) => runTool(() => post("/apple-pay/domain", params))
    );

    tool("list_apple_pay_domains", "List domains registered for Apple Pay.", {}, async () =>
      runTool(() => get("/apple-pay/domain"))
    );

    tool(
      "unregister_apple_pay_domain",
      "Unregister a domain from Apple Pay.",
      { domainName: z.string() },
      async (params) => runTool(() => del("/apple-pay/domain", params))
    );

    // ---------------------------------------------------------------------
    // Terminal (POS)
    // ---------------------------------------------------------------------

    tool(
      "send_terminal_event",
      "Send an event (e.g. an invoice to display) to a POS terminal.",
      { terminal_id: z.string(), type: z.string(), action: z.string(), data: z.record(z.any()) },
      async ({ terminal_id, ...rest }) => runTool(() => post(`/terminal/${encodeURIComponent(terminal_id)}/event`, rest))
    );

    tool(
      "fetch_terminal_event_status",
      "Check the delivery status of an event sent to a terminal.",
      { terminal_id: z.string(), event_id: z.string() },
      async ({ terminal_id, event_id }) =>
        runTool(() => get(`/terminal/${encodeURIComponent(terminal_id)}/event/${encodeURIComponent(event_id)}`))
    );

    tool(
      "fetch_terminal_status",
      "Check whether a POS terminal is online.",
      { terminal_id: z.string() },
      async ({ terminal_id }) => runTool(() => get(`/terminal/${encodeURIComponent(terminal_id)}/presence`))
    );

    tool(
      "list_terminals",
      "List POS terminals on the account.",
      { perPage: z.number().int().positive().optional(), next: z.string().optional(), previous: z.string().optional() },
      async (params) => runTool(() => get(`/terminal${toQueryString(compact(params))}`))
    );

    tool(
      "fetch_terminal",
      "Fetch a single POS terminal.",
      { terminal_id: z.string() },
      async ({ terminal_id }) => runTool(() => get(`/terminal/${encodeURIComponent(terminal_id)}`))
    );

    tool(
      "update_terminal",
      "Update a POS terminal's name or address.",
      { terminal_id: z.string(), name: z.string().optional(), address: z.string().optional() },
      async ({ terminal_id, ...rest }) => runTool(() => put(`/terminal/${encodeURIComponent(terminal_id)}`, compact(rest)))
    );

    tool(
      "commission_terminal",
      "Activate a POS terminal by its serial number.",
      { serial_number: z.string() },
      async (params) => runTool(() => post("/terminal/commission_device", params))
    );

    tool(
      "decommission_terminal",
      "Deactivate a POS terminal by its serial number.",
      { serial_number: z.string() },
      async (params) => runTool(() => post("/terminal/decommission_device", params))
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return PaystackMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return PaystackMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    return new Response("Not found. MCP endpoints: /mcp (Streamable HTTP), /sse (SSE).", {
      status: 404,
    });
  },
};
