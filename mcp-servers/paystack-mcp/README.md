# Paystack MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
[Paystack API](https://paystack.com/docs/api/) as tools, running on Cloudflare Workers.

## Tools

| Tool | Description |
|---|---|
| `get_balance` | Fetch the current Paystack balance |
| `list_transactions` | List transactions, filterable by date range / status / customer |
| `get_transaction` | Fetch a single transaction by ID or reference |
| `list_settlements` | Fetch all settlements |
| `get_settlement_transactions` | Fetch transactions for a specific settlement |
| `create_transfer_recipient` | Create a bank account recipient |
| `list_recipients` | List all transfer recipients |
| `initiate_transfer` | Send money to a recipient |
| `bulk_transfer` | Initiate multiple transfers at once |
| `get_transfer` | Fetch status of a specific transfer |
| `list_transfers` | List all transfers with filters |
| `create_refund` | Initiate a refund for a transaction |
| `list_customers` | List all customers |
| `get_customer` | Fetch a single customer by email or code |
| `create_split` | Create a payment split configuration |
| `list_splits` | List all payment splits |

## Setup

```bash
cd mcp-servers/paystack-mcp
npm install
```

## Local development

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and put a Paystack TEST secret key in it (sk_test_...)
npm run dev
```

`.dev.vars` is gitignored. **Never put a live secret key (`sk_live_...`) in a file that gets
committed to this repo.**

## Deploy

```bash
npm run deploy
# then, once (per environment):
npx wrangler secret put PAYSTACK_SECRET_KEY
```

`wrangler secret put` stores the key encrypted in Cloudflare and injects it as `env.PAYSTACK_SECRET_KEY`
at runtime — it is never written to source control or to `wrangler.jsonc`.

If you deploy via Cloudflare's Git integration (Workers Builds) instead of the CLI, set the
`PAYSTACK_SECRET_KEY` secret from the Worker's **Settings → Variables and Secrets** page in the
Cloudflare dashboard after the first deploy.

If your account's plan requires a paid tier for Durable Objects, deploy under a Workers Paid plan,
or ask about the current Durable Objects free-tier limits in the Cloudflare dashboard.

## Connecting to Claude

Once deployed, the server is reachable at:

```
https://paystack-mcp.<your-subdomain>.workers.dev/mcp
```

Add it as a remote MCP server / custom connector in Claude using that URL.

## Notes

- Amount fields (`amount` on `initiate_transfer`, `bulk_transfer`, `create_refund`) are in the
  smallest currency unit — e.g. **kobo** for NGN, **cents** for USD/GHS — matching the Paystack API.
- Every tool returns a JSON payload. On failure, the response has `isError: true` and a JSON
  `{ "error": "..." }` body describing what went wrong (validation error, HTTP error from Paystack, etc).
