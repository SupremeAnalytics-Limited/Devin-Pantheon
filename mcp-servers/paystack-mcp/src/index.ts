import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  PAYSTACK_SECRET_KEY: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Builds a query string from a params object, dropping undefined/null values. */
function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function paystackRequest(
  env: Env,
  method: "GET" | "POST" | "PUT",
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
  server = new McpServer({ name: "paystack-mcp", version: "1.0.0" });

  async init() {
    this.server.tool(
      "get_balance",
      "Fetch the current Paystack account balance across all supported currencies.",
      {},
      async () => runTool(() => paystackRequest(this.env, "GET", "/balance"))
    );

    this.server.tool(
      "list_transactions",
      "List Paystack transactions, optionally filtered by date range, status, or customer.",
      {
        perPage: z.number().int().positive().max(100).optional().describe("Number of records per page (default 50)"),
        page: z.number().int().positive().optional().describe("Page number to fetch"),
        from: z.string().optional().describe("Start date, ISO 8601 (e.g. 2024-01-01)"),
        to: z.string().optional().describe("End date, ISO 8601 (e.g. 2024-01-31)"),
        status: z.enum(["failed", "success", "abandoned"]).optional().describe("Filter by transaction status"),
        customer: z.union([z.string(), z.number()]).optional().describe("Filter by customer ID"),
      },
      async ({ perPage, page, from, to, status, customer }) =>
        runTool(() =>
          paystackRequest(
            this.env,
            "GET",
            `/transaction${toQueryString({ perPage, page, from, to, status, customer })}`
          )
        )
    );

    this.server.tool(
      "get_transaction",
      "Fetch a single transaction by its numeric ID or its reference string.",
      {
        id_or_reference: z
          .string()
          .describe("Numeric Paystack transaction ID, or the transaction reference"),
      },
      async ({ id_or_reference }) =>
        runTool(() => {
          const isNumericId = /^\d+$/.test(id_or_reference);
          const path = isNumericId
            ? `/transaction/${id_or_reference}`
            : `/transaction/verify/${encodeURIComponent(id_or_reference)}`;
          return paystackRequest(this.env, "GET", path);
        })
    );

    this.server.tool(
      "list_settlements",
      "Fetch all settlements paid out to the Paystack account.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        from: z.string().optional().describe("Start date, ISO 8601"),
        to: z.string().optional().describe("End date, ISO 8601"),
      },
      async ({ perPage, page, from, to }) =>
        runTool(() =>
          paystackRequest(this.env, "GET", `/settlement${toQueryString({ perPage, page, from, to })}`)
        )
    );

    this.server.tool(
      "get_settlement_transactions",
      "Fetch the transactions that make up a specific settlement.",
      {
        settlement_id: z.string().describe("The settlement ID"),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async ({ settlement_id, perPage, page }) =>
        runTool(() =>
          paystackRequest(
            this.env,
            "GET",
            `/settlement/${encodeURIComponent(settlement_id)}/transactions${toQueryString({ perPage, page })}`
          )
        )
    );

    this.server.tool(
      "create_transfer_recipient",
      "Create a transfer recipient (bank account) that money can later be sent to.",
      {
        name: z.string().describe("Recipient's full name"),
        account_number: z.string().describe("Bank account number"),
        bank_code: z.string().describe("Paystack bank code for the recipient's bank"),
        currency: z.string().optional().default("NGN").describe("Currency code, defaults to NGN"),
        type: z.string().optional().default("nuban").describe("Recipient type, defaults to nuban"),
        description: z.string().optional(),
      },
      async ({ name, account_number, bank_code, currency, type, description }) =>
        runTool(() =>
          paystackRequest(this.env, "POST", "/transferrecipient", {
            type,
            name,
            account_number,
            bank_code,
            currency,
            description,
          })
        )
    );

    this.server.tool(
      "list_recipients",
      "List all transfer recipients configured on the account.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async ({ perPage, page }) =>
        runTool(() =>
          paystackRequest(this.env, "GET", `/transferrecipient${toQueryString({ perPage, page })}`)
        )
    );

    this.server.tool(
      "initiate_transfer",
      "Send money from the Paystack balance to a transfer recipient.",
      {
        recipient_code: z.string().describe("The recipient_code returned by create_transfer_recipient"),
        amount: z
          .number()
          .positive()
          .describe("Amount to transfer, in the smallest currency unit (e.g. kobo for NGN)"),
        reason: z.string().optional().describe("Reason for the transfer"),
        currency: z.string().optional(),
        reference: z.string().optional().describe("Unique client-supplied transfer reference"),
      },
      async ({ recipient_code, amount, reason, currency, reference }) =>
        runTool(() =>
          paystackRequest(this.env, "POST", "/transfer", {
            source: "balance",
            amount,
            recipient: recipient_code,
            reason,
            currency,
            reference,
          })
        )
    );

    this.server.tool(
      "bulk_transfer",
      "Initiate multiple transfers to different recipients in a single batch.",
      {
        currency: z.string().optional(),
        transfers: z
          .array(
            z.object({
              amount: z.number().positive().describe("Amount in the smallest currency unit"),
              recipient: z.string().describe("Recipient code"),
              reason: z.string().optional(),
              reference: z.string().optional(),
            })
          )
          .min(1)
          .describe("List of transfers to initiate"),
      },
      async ({ currency, transfers }) =>
        runTool(() =>
          paystackRequest(this.env, "POST", "/transfer/bulk", {
            source: "balance",
            currency,
            transfers,
          })
        )
    );

    this.server.tool(
      "get_transfer",
      "Fetch the status and details of a specific transfer by its ID or transfer code.",
      {
        id_or_code: z.string().describe("Numeric transfer ID or transfer code"),
      },
      async ({ id_or_code }) =>
        runTool(() => paystackRequest(this.env, "GET", `/transfer/${encodeURIComponent(id_or_code)}`))
    );

    this.server.tool(
      "list_transfers",
      "List all transfers, optionally filtered by status or date range.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        status: z.enum(["failed", "success", "reversed", "pending", "otp"]).optional(),
        from: z.string().optional().describe("Start date, ISO 8601"),
        to: z.string().optional().describe("End date, ISO 8601"),
      },
      async ({ perPage, page, status, from, to }) =>
        runTool(() =>
          paystackRequest(this.env, "GET", `/transfer${toQueryString({ perPage, page, status, from, to })}`)
        )
    );

    this.server.tool(
      "create_refund",
      "Initiate a refund for a previously successful transaction.",
      {
        transaction: z.string().describe("Transaction ID or reference to refund"),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("Amount to refund in the smallest currency unit; omit to refund in full"),
        currency: z.string().optional(),
        customer_note: z.string().optional().describe("Note shown to the customer"),
        merchant_note: z.string().optional().describe("Internal note for the merchant"),
      },
      async ({ transaction, amount, currency, customer_note, merchant_note }) =>
        runTool(() =>
          paystackRequest(this.env, "POST", "/refund", {
            transaction,
            amount,
            currency,
            customer_note,
            merchant_note,
          })
        )
    );

    this.server.tool(
      "list_customers",
      "List all customers registered on the Paystack account.",
      {
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async ({ perPage, page }) =>
        runTool(() => paystackRequest(this.env, "GET", `/customer${toQueryString({ perPage, page })}`))
    );

    this.server.tool(
      "get_customer",
      "Fetch a single customer by email address or customer code.",
      {
        email_or_code: z.string().describe("Customer's email address or customer code"),
      },
      async ({ email_or_code }) =>
        runTool(() => paystackRequest(this.env, "GET", `/customer/${encodeURIComponent(email_or_code)}`))
    );

    this.server.tool(
      "create_split",
      "Create a payment split configuration that divides transaction proceeds between subaccounts.",
      {
        name: z.string().describe("Name for the split"),
        type: z.enum(["percentage", "flat"]).describe("How each subaccount's share is calculated"),
        currency: z.string().optional().default("NGN"),
        subaccounts: z
          .array(
            z.object({
              subaccount: z.string().describe("Subaccount code"),
              share: z.number().positive().describe("Share value (percentage or flat amount depending on type)"),
            })
          )
          .min(1),
        bearer_type: z.enum(["subaccount", "account", "all-proportional", "all"]).optional(),
        bearer_subaccount: z.string().optional().describe("Required when bearer_type is 'subaccount'"),
      },
      async ({ name, type, currency, subaccounts, bearer_type, bearer_subaccount }) =>
        runTool(() =>
          paystackRequest(this.env, "POST", "/split", {
            name,
            type,
            currency,
            subaccounts,
            bearer_type,
            bearer_subaccount,
          })
        )
    );

    this.server.tool(
      "list_splits",
      "List all payment split configurations on the account.",
      {
        name: z.string().optional().describe("Filter by split name"),
        active: z.boolean().optional().describe("Filter by active status"),
        perPage: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      async ({ name, active, perPage, page }) =>
        runTool(() =>
          paystackRequest(this.env, "GET", `/split${toQueryString({ name, active, perPage, page })}`)
        )
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
