import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  MANUS_API_KEY: string;
  MANUS_API_BASE_URL?: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const DEFAULT_BASE_URL = "https://api.manus.ai";

function baseUrl(env: Env): string {
  return (env.MANUS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function assertApiKey(env: Env) {
  if (!env.MANUS_API_KEY) {
    throw new Error("MANUS_API_KEY is not configured. Set it with `wrangler secret put MANUS_API_KEY`.");
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message =
      (json as { message?: string; error?: string } | null)?.message ??
      (json as { message?: string; error?: string } | null)?.error ??
      res.statusText ??
      "Unknown error";
    throw new Error(`Manus API error (HTTP ${res.status}): ${message}`);
  }
  return json;
}

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Manus API v2 is an RPC-style surface: every call targets
 * `/v2/<resource>.<verb>`, authenticated via the `x-manus-api-key` header
 * (not `Authorization: Bearer`). Read-style verbs (`.list`, `.detail`) are
 * GET with query params; mutating verbs (`.create`, `.sendMessage`) are
 * POST with a JSON body — confirmed by live-testing against the real API.
 */
async function manusRequest(
  env: Env,
  httpMethod: "GET" | "POST",
  rpcMethod: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  assertApiKey(env);
  const url =
    httpMethod === "GET"
      ? `${baseUrl(env)}/v2/${rpcMethod}${toQueryString(params)}`
      : `${baseUrl(env)}/v2/${rpcMethod}`;
  const res = await fetch(url, {
    method: httpMethod,
    headers: {
      "x-manus-api-key": env.MANUS_API_KEY,
      ...(httpMethod === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: httpMethod === "POST" ? JSON.stringify(params) : undefined,
  });
  return parseResponse(res);
}

/**
 * file.upload is a two-step flow, not a direct multipart POST: first ask
 * Manus for a file record + presigned S3 upload_url, then PUT the raw bytes
 * there directly (bypassing the Worker for the actual transfer).
 */
async function manusUploadFile(
  env: Env,
  filename: string,
  contentBase64: string,
  contentType: string
): Promise<{ file: { id: string; filename: string }; upload_url: string; upload_expires_at?: string }> {
  const created = (await manusRequest(env, "POST", "file.upload", { filename })) as {
    file: { id: string; filename: string };
    upload_url: string;
    upload_expires_at?: string;
  };

  const binary = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
  const putRes = await fetch(created.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: binary,
  });
  if (!putRes.ok) {
    throw new Error(`Uploading file bytes to Manus's storage failed (HTTP ${putRes.status}): ${putRes.statusText}`);
  }

  return created;
}

/** Builds task.create/task.sendMessage `message.content` — plain text, or a ContentPart array when files are attached. */
function buildMessageContent(text: string, fileIds?: string[]): unknown {
  if (!fileIds || fileIds.length === 0) return text;
  return [{ type: "text", text }, ...fileIds.map((file_id) => ({ type: "file", file_id }))];
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

async function runTool(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return toolResult(data);
  } catch (err) {
    return errorResult(err);
  }
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

export class ManusMCP extends McpAgent<Env> {
  server = new McpServer({ name: "manus-mcp", version: "1.0.0" });

  async init() {
    this.server.tool(
      "create_task",
      "Create a new Manus task from a prompt, optionally scoped to a project and with file attachments.",
      {
        prompt: z.string().describe("The instruction/prompt for the task"),
        project_id: z.string().optional().describe("Optional project ID to run the task under"),
        file_ids: z
          .array(z.string())
          .optional()
          .describe("File IDs from upload_file to attach to this task's initial message"),
      },
      async ({ prompt, project_id, file_ids }) =>
        runTool(() =>
          manusRequest(
            this.env,
            "POST",
            "task.create",
            compact({ message: { content: buildMessageContent(prompt, file_ids) }, project_id })
          )
        )
    );

    this.server.tool(
      "get_task",
      "Fetch the status and result of a Manus task by its ID.",
      {
        task_id: z.string().describe("The task ID"),
      },
      async ({ task_id }) => runTool(() => manusRequest(this.env, "GET", "task.detail", { task_id }))
    );

    this.server.tool(
      "get_task_messages",
      "Fetch the full conversation/event history for a task — the actual output Manus produced, " +
        "not just its status. Use this after get_task shows a task is done to read what it found.",
      {
        task_id: z.string().describe("The task ID"),
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ task_id, page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", "task.listMessages", compact({ task_id, page, page_size })))
    );

    this.server.tool(
      "send_message",
      "Send a follow-up message to an existing, in-progress or completed task, optionally with file attachments.",
      {
        task_id: z.string().describe("The task ID to message"),
        message: z.string().describe("The message content"),
        file_ids: z.array(z.string()).optional().describe("File IDs from upload_file to attach to this message"),
      },
      async ({ task_id, message, file_ids }) =>
        runTool(() =>
          manusRequest(this.env, "POST", "task.sendMessage", {
            task_id,
            message: { content: buildMessageContent(message, file_ids) },
          })
        )
    );

    this.server.tool(
      "list_tasks",
      "List Manus tasks, optionally filtered by project.",
      {
        project_id: z.string().optional().describe("Filter tasks by project ID"),
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ project_id, page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", "task.list", compact({ project_id, page, page_size })))
    );

    this.server.tool(
      "create_project",
      "Create a new Manus project with a name and optional standing instructions.",
      {
        name: z.string().describe("Project name"),
        instructions: z.string().optional().describe("Standing instructions applied to tasks in this project"),
      },
      async ({ name, instructions }) =>
        runTool(() => manusRequest(this.env, "POST", "project.create", compact({ name, instructions })))
    );

    this.server.tool(
      "list_projects",
      "List all Manus projects.",
      {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", "project.list", compact({ page, page_size })))
    );

    this.server.tool(
      "get_project",
      "Fetch a single Manus project by its ID.",
      {
        project_id: z.string().describe("The project ID"),
      },
      async ({ project_id }) => runTool(() => manusRequest(this.env, "GET", "project.detail", { project_id }))
    );

    this.server.tool(
      "upload_file",
      "Upload a file to Manus (base64-encoded content). Returns a file_id — pass it in create_task's or " +
        "send_message's file_ids to attach it to a task. Uploaded files are auto-deleted after 48 hours.",
      {
        filename: z.string().describe("The file name, including extension"),
        content_base64: z.string().describe("Base64-encoded file content"),
        content_type: z.string().optional().default("application/octet-stream").describe("MIME type of the file"),
      },
      async ({ filename, content_base64, content_type }) =>
        runTool(() => manusUploadFile(this.env, filename, content_base64, content_type))
    );

    this.server.tool(
      "list_agents",
      "List all agents configured on the Manus account.",
      {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", "agent.list", compact({ page, page_size })))
    );

    this.server.tool(
      "get_agent",
      "Fetch a single configured agent by its ID.",
      {
        agent_id: z.string().describe("The agent ID"),
      },
      async ({ agent_id }) => runTool(() => manusRequest(this.env, "GET", "agent.detail", { agent_id }))
    );

    this.server.tool(
      "list_skills",
      "List skills available to Manus agents/tasks.",
      {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", "skill.list", compact({ page, page_size })))
    );

    this.server.tool(
      "get_usage",
      "Fetch current Manus API usage and consumption (credit balance) for the account.",
      {},
      async () =>
        errorResult(
          "Manus's public API v2 does not document a usage/credits endpoint (its docs list only " +
            "Tasks, Projects, Files, Webhooks, Skills, and Agents as resource groups). Credit usage " +
            "currently appears to be dashboard-only — check https://open.manus.im/docs/v2 for updates, " +
            "or contact api-support@manus.ai to confirm."
        )
    );

    this.server.tool(
      "create_webhook",
      "Register a webhook URL to receive push notifications when a task's state changes.",
      { url: z.string().describe("HTTPS endpoint that will receive POST webhook notifications; must return 2xx") },
      async ({ url }) => runTool(() => manusRequest(this.env, "POST", "webhook.create", { url }))
    );

    this.server.tool(
      "list_webhooks",
      "List registered webhooks. (Endpoint name inferred from the same convention as other list calls — " +
        "not individually confirmed; verify if this 404s.)",
      { page: z.number().int().positive().optional(), page_size: z.number().int().positive().max(100).optional() },
      async ({ page, page_size }) => runTool(() => manusRequest(this.env, "GET", "webhook.list", compact({ page, page_size })))
    );

    this.server.tool(
      "delete_webhook",
      "Delete a webhook. The endpoint stops receiving notifications immediately.",
      { webhook_id: z.string() },
      async ({ webhook_id }) => runTool(() => manusRequest(this.env, "POST", "webhook.delete", { webhook_id }))
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return ManusMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return ManusMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    return new Response("Not found. MCP endpoints: /mcp (Streamable HTTP), /sse (SSE).", {
      status: 404,
    });
  },
};
