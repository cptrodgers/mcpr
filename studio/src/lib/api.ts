/**
 * Get the mcpr proxy base URL.
 *
 * Priority:
 * 1. ?proxy= query param (hosted studio connecting to remote mcpr)
 * 2. In dev mode, default to localhost:3000
 * 3. Same origin (when studio is served by mcpr itself)
 */
export function getBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const proxy = params.get("proxy");
  if (proxy) {
    return proxy.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }
  return window.location.origin;
}

/** Check if studio is connected to a remote proxy (vs local) */
export function isRemoteProxy(): boolean {
  return new URLSearchParams(window.location.search).has("proxy");
}

export interface WidgetInfo {
  name: string;
  url: string;
}

export async function fetchWidgets(): Promise<WidgetInfo[]> {
  const resp = await fetch(`${getBaseUrl()}/widgets`);
  const data = await resp.json();
  return data.widgets || [];
}

export function getRawWidgetUrl(name: string): string {
  return `${getBaseUrl()}/widgets/${name}.html?raw=1`;
}

// ── Auth ──

const AUTH_STORAGE_KEY = "mcpr_studio_auth_token";

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_STORAGE_KEY) || "";
}

export function setAuthToken(token: string) {
  if (token) {
    localStorage.setItem(AUTH_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  resetSession();
}

/**
 * Returns the active bearer token — from OAuth if in oauth mode, or from
 * the manual bearer token field.
 */
export function getActiveToken(): string {
  const method = localStorage.getItem("mcpr_studio_auth_method") || "bearer";
  if (method === "oauth") {
    // Look for OAuth token stored per-origin
    const origin = new URL(getBaseUrl()).origin;
    return localStorage.getItem(`mcpr_oauth_${origin}_access_token`) || "";
  }
  return getAuthToken();
}

// ── MCP JSON-RPC ──

let rpcId = 0;
let sessionId: string | null = null;
let initPromise: Promise<void> | null = null;

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const token = getActiveToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function rawMcpPost(
  method: string,
  params: Record<string, unknown> = {}
): Promise<Response> {
  return fetch(getBaseUrl(), {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}

/** Parse a response that may be JSON or SSE-wrapped JSON (data: {...}\n\n) */
async function parseResponse(resp: Response): Promise<Record<string, unknown>> {
  const contentType = resp.headers.get("content-type") || "";
  const text = await resp.text();

  // SSE-wrapped: extract JSON from "data: {...}" lines
  if (contentType.includes("text/event-stream") || text.startsWith("data:")) {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr) {
          try {
            return JSON.parse(jsonStr);
          } catch {
            // continue to next data line
          }
        }
      }
    }
    throw new Error("No valid JSON found in SSE response");
  }

  return JSON.parse(text);
}

async function ensureSession(): Promise<void> {
  if (sessionId) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const resp = await rawMcpPost("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcpr-studio", version: "1.0.0" },
    });

    // Capture session id from response header
    const sid = resp.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    const data = await parseResponse(resp);
    if (data.error)
      throw new Error(
        (data.error as { message?: string }).message ||
          JSON.stringify(data.error)
      );

    // Send initialized notification (no id = notification)
    await fetch(getBaseUrl(), {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

/** Reset MCP session (e.g. after token change) */
export function resetSession() {
  sessionId = null;
  initPromise = null;
}

export async function mcpCall(
  method: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  await ensureSession();
  const resp = await rawMcpPost(method, params);
  const data = await parseResponse(resp);
  if (data.error)
    throw new Error(
      (data.error as { message?: string }).message || JSON.stringify(data.error)
    );
  return data.result;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export async function listTools(): Promise<McpToolInfo[]> {
  const result = (await mcpCall("tools/list")) as { tools?: McpToolInfo[] };
  return result.tools || [];
}

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return mcpCall("tools/call", { name, arguments: args });
}

export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  meta?: Record<string, unknown>;
}

export async function listResources(): Promise<McpResourceInfo[]> {
  const result = (await mcpCall("resources/list")) as {
    resources?: McpResourceInfo[];
  };
  return result.resources || [];
}

export async function readResource(uri: string): Promise<unknown> {
  return mcpCall("resources/read", { uri });
}
