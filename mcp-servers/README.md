# MCP Servers

Two independent [Model Context Protocol](https://modelcontextprotocol.io) servers, each a
standalone Cloudflare Worker:

- **[`paystack-mcp/`](./paystack-mcp)** — tools for the [Paystack API](https://paystack.com/docs/api/)
  (balance, transactions, settlements, transfers, refunds, customers, splits).
- **[`manus-mcp/`](./manus-mcp)** — tools for the Manus API (tasks, projects, agents, skills, usage).

Each is deployed and configured independently — see each project's own README for setup, local
dev, and deployment instructions.

## Security

Neither project hardcodes an API key anywhere. Both read their credential from a Cloudflare
Workers **secret** (`PAYSTACK_SECRET_KEY`, `MANUS_API_KEY`) set via `wrangler secret put` or the
Cloudflare dashboard, never from a file committed to this repo. `.dev.vars` (used only for local
`wrangler dev`) is gitignored.

## Deploying via Cloudflare Git integration

Instead of running `wrangler deploy` from a machine, you can connect this repo to Cloudflare
Workers Builds so it deploys automatically on push:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Connect to Git**, pick this repo.
2. Set the **Root directory** to `mcp-servers/paystack-mcp` (repeat as a second Worker with root
   directory `mcp-servers/manus-mcp`).
3. Build command: `npm install` (wrangler picks up `wrangler.jsonc` automatically). Deploy command
   defaults to `npx wrangler deploy`.
4. After the first deploy, open each Worker's **Settings → Variables and Secrets** and add the
   corresponding secret (`PAYSTACK_SECRET_KEY` / `MANUS_API_KEY`) there — this keeps it out of git
   entirely.
