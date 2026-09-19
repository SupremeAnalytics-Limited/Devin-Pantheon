# Paystack MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
[Paystack API](https://paystack.com/docs/api/) as tools, running on Cloudflare Workers.

## Tools

Full coverage of Paystack's public REST API (~110 tools), grouped by resource:

- **Transactions** — `initialize_transaction`, `list_transactions`, `get_transaction`, `verify_transaction`, `charge_authorization`, `view_transaction_timeline`, `get_transaction_totals`, `export_transactions`, `partial_debit`
- **Transaction Splits** — `create_split`, `list_splits`, `get_split`, `update_split`, `add_split_subaccount`, `remove_split_subaccount`
- **Customers** — `list_customers`, `get_customer`, `create_customer`, `update_customer`, `validate_customer`, `set_customer_risk_action`, `deactivate_authorization`
- **Dedicated Virtual Accounts** — `create_dedicated_account`, `assign_dedicated_account`, `list_dedicated_accounts`, `get_dedicated_account`, `deactivate_dedicated_account`, `split_dedicated_account`, `remove_dedicated_account_split`, `list_dedicated_account_providers`
- **Subaccounts** — `create_subaccount`, `list_subaccounts`, `get_subaccount`, `update_subaccount`
- **Plans & Subscriptions** — `create_plan`, `list_plans`, `get_plan`, `update_plan`, `create_subscription`, `list_subscriptions`, `get_subscription`, `enable_subscription`, `disable_subscription`, `generate_subscription_update_link`, `send_subscription_update_link`
- **Products & Payment Pages** — `create_product`, `list_products`, `get_product`, `update_product`, `create_payment_page`, `list_payment_pages`, `get_payment_page`, `update_payment_page`, `check_payment_page_slug`, `add_products_to_page`
- **Invoices** — `create_invoice`, `list_invoices`, `get_invoice`, `verify_invoice`, `send_invoice_notification`, `get_invoice_totals`, `finalize_invoice`, `update_invoice`, `archive_invoice`
- **Settlements** — `list_settlements`, `get_settlement_transactions`
- **Transfer Recipients** — `create_transfer_recipient`, `bulk_create_transfer_recipients`, `list_recipients`, `get_transfer_recipient`, `update_transfer_recipient`, `delete_transfer_recipient`
- **Transfers** — `initiate_transfer`, `bulk_transfer`, `get_transfer`, `list_transfers`, `finalize_transfer`, `verify_transfer`, `fetch_balance_ledger`, `resend_transfer_otp`, `disable_transfer_otp`, `enable_transfer_otp`, `finalize_disable_transfer_otp`
- **Bulk Charges** — `initiate_bulk_charge`, `list_bulk_charges`, `get_bulk_charge`, `pause_bulk_charge`, `resume_bulk_charge`, `list_bulk_charge_units`
- **Direct Charge** — `create_charge`, `submit_pin`, `submit_otp`, `submit_phone`, `submit_birthday`, `submit_address`, `check_pending_charge`
- **Disputes** — `list_disputes`, `get_dispute`, `list_transaction_disputes`, `update_dispute`, `add_dispute_evidence`, `get_dispute_upload_url`, `resolve_dispute`, `export_disputes`
- **Refunds** — `create_refund`, `list_refunds`, `get_refund`
- **Verification & Misc** — `resolve_account_number`, `validate_account`, `resolve_card_bin`, `list_banks`, `list_countries`, `list_states`
- **Apple Pay** — `register_apple_pay_domain`, `list_apple_pay_domains`, `unregister_apple_pay_domain`
- **Terminal (POS)** — `send_terminal_event`, `fetch_terminal_event_status`, `fetch_terminal_status`, `list_terminals`, `fetch_terminal`, `update_terminal`, `commission_terminal`, `decommission_terminal`
- **Account** — `get_balance`

All tools are live-tested for correctness of the request/response plumbing; `get_balance` and the
transaction/customer/split reads have been exercised against a real account. Endpoints requiring
side effects with real money (transfers, charges) or specific setup (disputes, terminals, Apple
Pay domains) follow Paystack's documented request/response shapes but weren't individually
exercised live — verify against [Paystack's API reference](https://paystack.com/docs/api/) if one
behaves unexpectedly.

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
