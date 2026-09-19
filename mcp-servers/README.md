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

## Deploying via GitHub Actions

`.github/workflows/deploy-mcp-servers.yml` deploys both Workers automatically on every push to
`main` that touches `mcp-servers/**` (or on-demand via **Actions → Deploy MCP Servers → Run
workflow**). It needs two repository secrets, added under **Settings → Secrets and variables →
Actions**:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with "Edit Cloudflare Workers" permission.
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.

Once those exist, push to `main` (or run the workflow manually) and both Workers deploy. The run's
log prints each Worker's live `*.workers.dev` URL.

To set the API keys the Workers actually call out with, add two more repo secrets —
`PAYSTACK_SECRET_KEY` and `MANUS_API_KEY` — then run **Actions → Set MCP Worker Secrets → Run
workflow** once. That workflow only runs on manual dispatch (never automatically), so it can't
accidentally overwrite a live secret with an empty value if a GitHub secret hasn't been set yet.

None of these four values are ever written into this repo — they live only as encrypted GitHub
Actions secrets and, after the second workflow runs, as encrypted Cloudflare Worker secrets.

## Deploying via Cloudflare Git integration (alternative)

Instead of GitHub Actions, you can connect this repo to Cloudflare Workers Builds directly so
Cloudflare deploys on push:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Connect to Git**, pick this repo.
2. Set the **Root directory** to `mcp-servers/paystack-mcp` (repeat as a second Worker with root
   directory `mcp-servers/manus-mcp`).
3. Build command: `npm install` (wrangler picks up `wrangler.jsonc` automatically). Deploy command
   defaults to `npx wrangler deploy`.
4. After the first deploy, open each Worker's **Settings → Variables and Secrets** and add the
   corresponding secret (`PAYSTACK_SECRET_KEY` / `MANUS_API_KEY`) there — this keeps it out of git
   entirely.
