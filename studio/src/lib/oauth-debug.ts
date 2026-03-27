/**
 * OAuth 2.1 Debug Logger
 *
 * Captures every HTTP request/response in the OAuth flow for the debugger panel.
 * Also provides MCP spec compliance checking and token decoding.
 */

// ── Types ──

export type OAuthFlowStep =
  | "metadata_discovery"
  | "client_registration"
  | "authorization"
  | "token_exchange"
  | "token_refresh"
  | "endpoint_test";

export type OAuthEventStatus = "pending" | "success" | "error";

export interface OAuthDebugEvent {
  id: string;
  step: OAuthFlowStep;
  status: OAuthEventStatus;
  time: string;
  durationMs?: number;
  request?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers?: Record<string, string>;
    body?: string;
  };
  error?: string;
  hint?: string;
}

export interface OAuthServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  [key: string]: unknown;
}

export interface ComplianceCheck {
  field: string;
  value: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DecodedToken {
  isJwt: boolean;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  expiresAt?: Date;
  scopes?: string[];
  raw: string;
}

// ── Event ID generator ──

let eventCounter = 0;
function nextEventId(): string {
  return `oauth_${++eventCounter}_${Date.now()}`;
}

function formatTimestamp(): string {
  const now = new Date();
  return (
    now.toTimeString().split(" ")[0] +
    "." +
    String(now.getMilliseconds()).padStart(3, "0")
  );
}

// ── Debug Event Creation ──

export function createPendingEvent(
  step: OAuthFlowStep,
  request: OAuthDebugEvent["request"]
): OAuthDebugEvent {
  return {
    id: nextEventId(),
    step,
    status: "pending",
    time: formatTimestamp(),
    request,
  };
}

export function resolveEvent(
  event: OAuthDebugEvent,
  response: OAuthDebugEvent["response"],
  durationMs: number
): OAuthDebugEvent {
  const isError = response && response.status >= 400;
  return {
    ...event,
    status: isError ? "error" : "success",
    durationMs,
    response,
    hint: isError ? getErrorHint(event.step, response) : undefined,
  };
}

export function rejectEvent(
  event: OAuthDebugEvent,
  error: string,
  durationMs: number
): OAuthDebugEvent {
  return {
    ...event,
    status: "error",
    durationMs,
    error,
    hint: getNetworkErrorHint(event.step, error),
  };
}

// ── Instrumented Fetch ──

export type DebugEventCallback = (event: OAuthDebugEvent) => void;

/**
 * Fetch wrapper that logs the request/response to the debug event stream.
 */
export async function debugFetch(
  step: OAuthFlowStep,
  url: string,
  init: RequestInit,
  onEvent: DebugEventCallback
): Promise<Response> {
  const reqHeaders: Record<string, string> = {};
  if (init.headers) {
    const h =
      init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init.headers as Record<string, string>);
    Object.assign(reqHeaders, h);
  }

  // Redact sensitive values in logged headers/body
  const safeHeaders = { ...reqHeaders };
  if (safeHeaders["Authorization"]) {
    safeHeaders["Authorization"] =
      safeHeaders["Authorization"].slice(0, 20) + "...";
  }

  const event = createPendingEvent(step, {
    method: init.method || "GET",
    url,
    headers: safeHeaders,
    body: typeof init.body === "string" ? init.body : undefined,
  });
  onEvent(event);

  const start = performance.now();
  try {
    const resp = await fetch(url, init);
    const durationMs = Math.round(performance.now() - start);

    // Clone and read body for logging
    const clone = resp.clone();
    let bodyText: string | undefined;
    try {
      bodyText = await clone.text();
    } catch {
      // body may not be readable
    }

    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    const resolved = resolveEvent(
      event,
      {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
        body: bodyText,
      },
      durationMs
    );
    onEvent(resolved);
    return resp;
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    const rejected = rejectEvent(event, (e as Error).message, durationMs);
    onEvent(rejected);
    throw e;
  }
}

// ── Error Hints ──

function getErrorHint(
  step: OAuthFlowStep,
  response?: OAuthDebugEvent["response"]
): string | undefined {
  if (!response) return undefined;
  const { status, body } = response;
  let errorCode = "";
  try {
    const parsed = JSON.parse(body || "{}");
    errorCode = parsed.error || "";
  } catch {
    // not JSON
  }

  if (step === "metadata_discovery" && status === 404) {
    return "Server doesn't support OAuth metadata discovery. Using fallback endpoints (/authorize, /token, /register).";
  }

  if (step === "client_registration") {
    if (status === 404)
      return "Dynamic client registration not supported. You'll need to enter a client_id manually.";
    if (status === 400)
      return "Registration request was rejected. Check that redirect_uri and grant_types are valid.";
  }

  if (step === "token_exchange") {
    if (errorCode === "invalid_client")
      return "Client ID not recognized. Does the server support dynamic registration? Or enter a valid client_id manually.";
    if (errorCode === "invalid_grant")
      return "Authorization code expired or already used. PKCE code_verifier may not match. Try signing in again.";
    if (errorCode === "invalid_request")
      return "Token request is malformed. Check that redirect_uri matches what was registered.";
  }

  if (step === "token_refresh") {
    if (errorCode === "invalid_grant")
      return "Refresh token expired or revoked. You'll need to sign in again.";
  }

  if (status === 0 || status === undefined) {
    return "Network error — is the MCP server running? Check CORS headers on the OAuth endpoints.";
  }

  return undefined;
}

function getNetworkErrorHint(step: OAuthFlowStep, error: string): string {
  if (error.includes("Failed to fetch") || error.includes("NetworkError")) {
    if (step === "metadata_discovery")
      return "Cannot reach the server. Is the MCP server running?";
    if (step === "token_exchange" || step === "token_refresh")
      return "Token endpoint unreachable. Check CORS — the token endpoint must allow requests from Studio's origin.";
    return "Network error. Check that the server is running and CORS is configured.";
  }
  return error;
}

// ── Server Metadata Compliance Checker ──

export function checkCompliance(
  metadata: OAuthServerMetadata
): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // Required by MCP spec
  checks.push({
    field: "issuer",
    value: metadata.issuer || "(missing)",
    status: metadata.issuer ? "pass" : "warn",
    message: metadata.issuer
      ? "Issuer declared"
      : "No issuer — recommended by RFC 8414",
  });

  checks.push({
    field: "authorization_endpoint",
    value: metadata.authorization_endpoint || "(missing)",
    status: metadata.authorization_endpoint ? "pass" : "fail",
    message: metadata.authorization_endpoint
      ? "Authorization endpoint declared"
      : "Missing — required for authorization code flow",
  });

  checks.push({
    field: "token_endpoint",
    value: metadata.token_endpoint || "(missing)",
    status: metadata.token_endpoint ? "pass" : "fail",
    message: metadata.token_endpoint
      ? "Token endpoint declared"
      : "Missing — required for token exchange",
  });

  checks.push({
    field: "registration_endpoint",
    value: metadata.registration_endpoint || "(missing)",
    status: metadata.registration_endpoint ? "pass" : "warn",
    message: metadata.registration_endpoint
      ? "Dynamic registration supported"
      : "Not available — MCP spec recommends RFC 7591 support",
  });

  // PKCE
  const methods = metadata.code_challenge_methods_supported || [];
  const hasS256 = methods.includes("S256");
  checks.push({
    field: "code_challenge_methods_supported",
    value: methods.length > 0 ? methods.join(", ") : "(missing)",
    status: hasS256 ? "pass" : methods.length > 0 ? "warn" : "warn",
    message: hasS256
      ? "PKCE S256 supported"
      : "S256 not declared — PKCE is required by MCP spec for all clients",
  });

  // Grant types
  const grants = metadata.grant_types_supported || [];
  const hasAuthCode =
    grants.includes("authorization_code") || grants.length === 0;
  checks.push({
    field: "grant_types_supported",
    value:
      grants.length > 0
        ? grants.join(", ")
        : "(missing — defaults to authorization_code)",
    status: hasAuthCode ? "pass" : "warn",
    message: hasAuthCode
      ? "Authorization code grant supported"
      : "authorization_code not listed in supported grants",
  });

  // Scopes
  const scopes = metadata.scopes_supported || [];
  checks.push({
    field: "scopes_supported",
    value: scopes.length > 0 ? scopes.join(", ") : "(not declared)",
    status: scopes.length > 0 ? "pass" : "warn",
    message:
      scopes.length > 0
        ? `${scopes.length} scope(s) declared`
        : "No scopes declared — clients won't know what to request",
  });

  return checks;
}

// ── Token Decoder ──

export function decodeToken(token: string): DecodedToken {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { isJwt: false, raw: token };
  }

  try {
    const header = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))
    );
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    let expiresAt: Date | undefined;
    if (payload.exp) {
      expiresAt = new Date(payload.exp * 1000);
    }

    let scopes: string[] | undefined;
    if (typeof payload.scope === "string") {
      scopes = payload.scope.split(" ").filter(Boolean);
    } else if (Array.isArray(payload.scp)) {
      scopes = payload.scp;
    }

    return { isJwt: true, header, payload, expiresAt, scopes, raw: token };
  } catch {
    return { isJwt: false, raw: token };
  }
}

// ── Step Labels ──

export const STEP_LABELS: Record<OAuthFlowStep, string> = {
  metadata_discovery: "Metadata Discovery",
  client_registration: "Client Registration",
  authorization: "Authorization",
  token_exchange: "Token Exchange",
  token_refresh: "Token Refresh",
  endpoint_test: "Endpoint Test",
};
