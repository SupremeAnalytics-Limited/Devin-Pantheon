# Manus MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
Manus API (`https://api.manus.ai`) as tools, running on Cloudflare Workers.

> **API shape, confirmed by live-testing.** Manus API v2 targets `/v2/<resource>.<verb>`,
> authenticated via the `x-manus-api-key` header (**not** `Authorization: Bearer`). Read-style
> verbs (`.list`, `.detail`) are **GET** with query params; mutating verbs (`.create`,
> `.sendMessage`) are **POST** with a JSON body — this split was found by live-testing against a
> deployed instance (list/detail calls first came back `405 Method Not Allowed` under POST) and
> cross-checked against [Manus's own docs](https://open.manus.ai/docs/v2/authentication).
> `create_task`, `get_task`, `send_message`, `list_tasks`, `create_project`, `list_projects`,
> `list_agents`, and `list_skills` map to endpoints confirmed either by the docs or by a live,
> successful (non-404/405) call. `get_project` (`project.detail`), `get_agent` (`agent.detail`),
> and `get_project`/`get_agent`/`list_webhooks` follow the same naming convention but weren't
> individually confirmed. `webhook.create` and `webhook.delete` are confirmed from the docs;
> `webhook.list` is inferred and may need a different name. **`get_usage` has no backing
> endpoint** — Manus's v2 docs list only six resource groups (Tasks, Projects, Files, Webhooks,
> Skills, Agents), no credits/usage group, and `credit.balance` 404'd in testing; the tool now
> returns an explanatory error instead of guessing further. `file.upload` is a **two-step** flow
> confirmed from the docs: `upload_file` POSTs `{filename}` to get a file record + presigned S3
> `upload_url`, then PUTs the raw bytes there directly — it is not a single multipart POST like the
> Paystack-style upload the first version of this server implemented. The returned `file_id` is
> passed via `file_ids` on `create_task`/`send_message` to attach it (Manus auto-deletes uploaded
> files after 48 hours). If Manus adds a usage endpoint, or you find the real name for an
> unconfirmed one, point the handler at it in `src/index.ts` — the request/response plumbing (auth,
> error handling, JSON shaping) stays the same. `MANUS_API_BASE_URL` is a plain Worker var (see
> `wrangler.json`) if the base URL needs to change.

## Tools

| Tool | Description |
|---|---|
| `create_task` | Create a new Manus task with a prompt, optional project ID, and file attachments |
| `get_task` | Fetch the status of a task by ID (metadata only, not its output) |
| `get_task_messages` | Fetch the full conversation/output for a task — what it actually produced |
| `send_message` | Send a follow-up message to an existing task, optionally with file attachments |
| `list_tasks` | List all tasks with optional project filter |
| `create_project` | Create a new project with a name and standing instructions |
| `list_projects` | List all projects |
| `get_project` | Fetch a specific project by ID |
| `upload_file` | Upload a file (base64); returns a file_id to attach via create_task/send_message |
| `list_agents` | List all configured agents |
| `get_agent` | Fetch a specific agent |
| `list_skills` | List available skills |
| `get_usage` | Explains that Manus's API has no usage/credits endpoint (dashboard-only) |
| `create_webhook` | Register a webhook URL for task state-change notifications |
| `list_webhooks` | List registered webhooks (endpoint name unconfirmed) |
| `delete_webhook` | Delete a webhook |

## Setup

```bash
cd mcp-servers/manus-mcp
npm install
```

## Local development

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and put a Manus API key in it
npm run dev
```

`.dev.vars` is gitignored. **Never put a real API key in a file that gets committed to this repo.**

## Deploy

```bash
npm run deploy
# then, once (per environment):
npx wrangler secret put MANUS_API_KEY
```

`wrangler secret put` stores the key encrypted in Cloudflare and injects it as `env.MANUS_API_KEY`
at runtime — it is never written to source control or to `wrangler.jsonc`.

If you deploy via Cloudflare's Git integration (Workers Builds) instead of the CLI, set the
`MANUS_API_KEY` secret from the Worker's **Settings → Variables and Secrets** page in the
Cloudflare dashboard after the first deploy.

## Connecting to Claude

Once deployed, the server is reachable at:

```
https://manus-mcp.<your-subdomain>.workers.dev/mcp
```

Add it as a remote MCP server / custom connector in Claude using that URL.

## Notes

- Every tool returns a JSON payload. On failure, the response has `isError: true` and a JSON
  `{ "error": "..." }` body describing what went wrong (validation error, HTTP error from Manus, etc).
- `upload_file` expects the file content base64-encoded in `content_base64`, decodes it, and PUTs
  it to the presigned URL Manus returns — see the note above on the two-step upload flow.
