# Manus MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
Manus API (`https://api.manus.ai`) as tools, running on Cloudflare Workers.

> **Endpoint paths are a best-effort mapping.** This server was written without access to a
> confirmed, current Manus API reference, so it assumes conventional REST paths under `/v1`
> (e.g. `POST /v1/tasks`, `GET /v1/tasks/:id`) and Bearer-token auth. **Before relying on this in
> production, check each path and payload shape against Manus's own API docs** and adjust
> `src/index.ts` if anything differs (the request/response plumbing — auth, error handling, JSON
> shaping — stays the same either way). `MANUS_API_BASE_URL` is a plain Worker var (see
> `wrangler.jsonc`) if the base URL needs to change.

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
