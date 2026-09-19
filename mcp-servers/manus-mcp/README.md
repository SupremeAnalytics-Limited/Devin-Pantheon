# Manus MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
Manus API (`https://api.manus.ai`) as tools, running on Cloudflare Workers.

> **Some endpoint shapes are still unconfirmed.** Manus API v2 is an RPC-style surface: every call
> is a `POST` to `/v2/<resource>.<verb>` with a JSON body, authenticated via the `x-manus-api-key`
> header (**not** `Authorization: Bearer`) — this was confirmed against
> [Manus's own docs](https://open.manus.ai/docs/v2/authentication) and by live-testing against a
> deployed instance. `create_task`, `get_task`, `send_message`, `list_tasks`, `create_project`,
> `list_projects`, and `list_agents` map to documented endpoints (`task.create`, `task.detail`,
> `task.sendMessage`, `task.list`, `project.create`, `project.list`, `agent.list`) and have been
> exercised live. `get_project` (`project.detail`), `get_agent` (`agent.detail`), `list_skills`
> (`skill.list`), `get_usage` (`credit.balance`), and `upload_file` (`file.upload`) follow the same
> naming convention but weren't individually confirmed — verify against
> [the official reference](https://open.manus.im/docs/v2) if one of those returns a 404 or an
> unexpected shape, and adjust the method name / body in `src/index.ts` (the request/response
> plumbing — auth, error handling, JSON shaping — stays the same either way).
> `MANUS_API_BASE_URL` is a plain Worker var (see `wrangler.json`) if the base URL needs to change.

## Tools

| Tool | Description |
|---|---|
| `create_task` | Create a new Manus task with a prompt and optional project ID |
| `get_task` | Fetch the status and result of a task by ID |
| `send_message` | Send a follow-up message to an existing task |
| `list_tasks` | List all tasks with optional project filter |
| `create_project` | Create a new project with a name and standing instructions |
| `list_projects` | List all projects |
| `get_project` | Fetch a specific project by ID |
| `upload_file` | Upload a file (base64) as a task attachment |
| `list_agents` | List all configured agents |
| `get_agent` | Fetch a specific agent |
| `list_skills` | List available skills |
| `get_usage` | Fetch current API usage and consumption |

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
- `upload_file` expects the file content base64-encoded in `content_base64`; the server decodes it
  and sends it as multipart form data.
