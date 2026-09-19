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

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
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

async function manusRequest(
  env: Env,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<unknown> {
  assertApiKey(env);
  const res = await fetch(`${baseUrl(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.MANUS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseResponse(res);
}

async function manusUpload(
  env: Env,
  path: string,
  filename: string,
  contentBase64: string,
  contentType: string
): Promise<unknown> {
  assertApiKey(env);
  const binary = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([binary], { type: contentType }), filename);

  const res = await fetch(`${baseUrl(env)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MANUS_API_KEY}`,
    },
    body: form,
  });
  return parseResponse(res);
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

export class ManusMCP extends McpAgent<Env> {
  server = new McpServer({ name: "manus-mcp", version: "1.0.0" });

  async init() {
    this.server.tool(
      "create_task",
      "Create a new Manus task from a prompt, optionally scoped to a project.",
      {
        prompt: z.string().describe("The instruction/prompt for the task"),
        project_id: z.string().optional().describe("Optional project ID to run the task under"),
      },
      async ({ prompt, project_id }) =>
        runTool(() => manusRequest(this.env, "POST", "/v1/tasks", { prompt, project_id }))
    );

    this.server.tool(
      "get_task",
      "Fetch the status and result of a Manus task by its ID.",
      {
        task_id: z.string().describe("The task ID"),
      },
      async ({ task_id }) =>
        runTool(() => manusRequest(this.env, "GET", `/v1/tasks/${encodeURIComponent(task_id)}`))
    );

    this.server.tool(
      "send_message",
      "Send a follow-up message to an existing, in-progress or completed task.",
      {
        task_id: z.string().describe("The task ID to message"),
        message: z.string().describe("The message content"),
      },
      async ({ task_id, message }) =>
        runTool(() =>
          manusRequest(this.env, "POST", `/v1/tasks/${encodeURIComponent(task_id)}/messages`, { message })
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
        runTool(() =>
          manusRequest(this.env, "GET", `/v1/tasks${toQueryString({ project_id, page, page_size })}`)
        )
    );

    this.server.tool(
      "create_project",
      "Create a new Manus project with a name and optional standing instructions.",
      {
        name: z.string().describe("Project name"),
        instructions: z.string().optional().describe("Standing instructions applied to tasks in this project"),
      },
      async ({ name, instructions }) =>
        runTool(() => manusRequest(this.env, "POST", "/v1/projects", { name, instructions }))
    );

    this.server.tool(
      "list_projects",
      "List all Manus projects.",
      {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", `/v1/projects${toQueryString({ page, page_size })}`))
    );

    this.server.tool(
      "get_project",
      "Fetch a single Manus project by its ID.",
      {
        project_id: z.string().describe("The project ID"),
      },
      async ({ project_id }) =>
        runTool(() => manusRequest(this.env, "GET", `/v1/projects/${encodeURIComponent(project_id)}`))
    );

    this.server.tool(
      "upload_file",
      "Upload a file as an attachment to an existing task. Provide the file content base64-encoded.",
      {
        task_id: z.string().describe("The task ID to attach the file to"),
        filename: z.string().describe("The file name, including extension"),
        content_base64: z.string().describe("Base64-encoded file content"),
        content_type: z.string().optional().default("application/octet-stream").describe("MIME type of the file"),
      },
      async ({ task_id, filename, content_base64, content_type }) =>
        runTool(() =>
          manusUpload(
            this.env,
            `/v1/tasks/${encodeURIComponent(task_id)}/attachments`,
            filename,
            content_base64,
            content_type
          )
        )
    );

    this.server.tool(
      "list_agents",
      "List all agents configured on the Manus account.",
      {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", `/v1/agents${toQueryString({ page, page_size })}`))
    );

    this.server.tool(
      "get_agent",
      "Fetch a single configured agent by its ID.",
      {
        agent_id: z.string().describe("The agent ID"),
      },
      async ({ agent_id }) =>
        runTool(() => manusRequest(this.env, "GET", `/v1/agents/${encodeURIComponent(agent_id)}`))
    );

    this.server.tool(
      "list_skills",
      "List skills available to Manus agents/tasks.",
      {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(100).optional(),
      },
      async ({ page, page_size }) =>
        runTool(() => manusRequest(this.env, "GET", `/v1/skills${toQueryString({ page, page_size })}`))
    );

    this.server.tool(
      "get_usage",
      "Fetch current Manus API usage and consumption for the account.",
      {},
      async () => runTool(() => manusRequest(this.env, "GET", "/v1/usage"))
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
