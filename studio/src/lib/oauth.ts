/**
 * OAuth 2.1 Client for MCP (per spec: modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
 *
 * Implements:
 * - Server Metadata Discovery (RFC 8414)
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization Code + PKCE flow
 * - Token refresh
 */

import {
  debugFetch,
  type DebugEventCallback,
  type OAuthServerMetadata,
} from "./oauth-debug";

// ── Storage keys (per-origin) ──

function storageKey(baseUrl: string, suffix: string): string {
  return `mcpr_oauth_${new URL(baseUrl).origin}_${suffix}`;
}

function store(baseUrl: string, key: string, value: string) {
  localStorage.setItem(storageKey(baseUrl, key), value);
}

function load(baseUrl: string, key: string): string | null {
  return localStorage.getItem(storageKey(baseUrl, key));
}

function remove(baseUrl: string, key: string) {
  localStorage.removeItem(storageKey(baseUrl, key));
}

// ── PKCE ──

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const codeVerifier = generateRandomString(64);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64url(hash);
  return { codeVerifier, codeChallenge };
}

// ── Authorization Base URL ──

/**
 * Per MCP spec: the authorization base URL is the MCP server URL with
 * the path component discarded.
 * e.g. https://api.example.com/v1/mcp → https://api.example.com
 */
export function getAuthBaseUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  return `${url.protocol}//${url.host}`;
}

// ── Server Metadata Discovery ──

export async function discoverMetadata(
  baseUrl: string,
  onEvent: DebugEventCallback
): Promise<OAuthServerMetadata | null> {
  const authBase = getAuthBaseUrl(baseUrl);
  const metadataUrl = `${authBase}/.well-known/oauth-authorization-server`;

  try {
    const resp = await debugFetch(
      "metadata_discovery",
      metadataUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "MCP-Protocol-Version": "2025-03-26",
        },
      },
      onEvent
    );

    if (!resp.ok) return null;
    return (await resp.json()) as OAuthServerMetadata;
  } catch {
    return null;
  }
}

/**
 * Get OAuth endpoints — from metadata or fallback defaults per MCP spec.
 */
export function resolveEndpoints(
  baseUrl: string,
  metadata: OAuthServerMetadata | null
): {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
} {
  const authBase = getAuthBaseUrl(baseUrl);

  return {
    authorizationEndpoint:
      metadata?.authorization_endpoint || `${authBase}/authorize`,
    tokenEndpoint: metadata?.token_endpoint || `${authBase}/token`,
    registrationEndpoint:
      metadata?.registration_endpoint || `${authBase}/register`,
  };
}

// ── Dynamic Client Registration (RFC 7591) ──

export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  onEvent: DebugEventCallback
): Promise<{ clientId: string; clientSecret?: string } | null> {
  try {
    const body = JSON.stringify({
      client_name: "mcpr-studio",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });

    const resp = await debugFetch(
      "client_registration",
      registrationEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      onEvent
    );

    if (!resp.ok) return null;

    const data = await resp.json();
    return {
      clientId: data.client_id,
      clientSecret: data.client_secret,
    };
  } catch {
    return null;
  }
}

// ── Authorization URL ──

export interface AuthorizationParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string[];
}

export function buildAuthorizationUrl(params: AuthorizationParams): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  if (params.scopes?.length) {
    url.searchParams.set("scope", params.scopes.join(" "));
  }
  return url.toString();
}

// ── Token Exchange ──

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  redirectUri: string,
  clientId: string,
  codeVerifier: string,
  onEvent: DebugEventCallback
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const resp = await debugFetch(
    "token_exchange",
    tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    onEvent
  );

  if (!resp.ok) {
    const errorBody = await resp.text();
    let msg = `Token exchange failed (${resp.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error_description) msg = parsed.error_description;
      else if (parsed.error) msg = parsed.error;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }

  return (await resp.json()) as TokenResponse;
}

export async function refreshAccessToken(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string,
  onEvent: DebugEventCallback
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const resp = await debugFetch(
    "token_refresh",
    tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    onEvent
  );

  if (!resp.ok) {
    const errorBody = await resp.text();
    let msg = `Token refresh failed (${resp.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error_description) msg = parsed.error_description;
      else if (parsed.error) msg = parsed.error;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }

  return (await resp.json()) as TokenResponse;
}

// ── Token Persistence ──

export function saveTokens(
  baseUrl: string,
  tokens: TokenResponse,
  clientId: string
) {
  store(baseUrl, "access_token", tokens.access_token);
  store(baseUrl, "token_type", tokens.token_type);
  store(baseUrl, "client_id", clientId);
  if (tokens.refresh_token) {
    store(baseUrl, "refresh_token", tokens.refresh_token);
  }
  if (tokens.expires_in) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    store(baseUrl, "expires_at", String(expiresAt));
  }
  if (tokens.scope) {
    store(baseUrl, "scope", tokens.scope);
  }
}

export function loadTokens(baseUrl: string): {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  clientId: string | null;
  scope: string | null;
} {
  const expiresAtStr = load(baseUrl, "expires_at");
  return {
    accessToken: load(baseUrl, "access_token"),
    refreshToken: load(baseUrl, "refresh_token"),
    expiresAt: expiresAtStr ? Number(expiresAtStr) : null,
    clientId: load(baseUrl, "client_id"),
    scope: load(baseUrl, "scope"),
  };
}

export function clearTokens(baseUrl: string) {
  for (const key of [
    "access_token",
    "refresh_token",
    "expires_at",
    "token_type",
    "client_id",
    "scope",
  ]) {
    remove(baseUrl, key);
  }
}

export function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) return false; // no expiry info → assume valid
  return Date.now() > expiresAt - 60_000; // 60s buffer
}

// ── PKCE State Persistence (for callback) ──

export function savePKCEState(
  baseUrl: string,
  codeVerifier: string,
  state: string
) {
  store(baseUrl, "pkce_verifier", codeVerifier);
  store(baseUrl, "pkce_state", state);
}

export function loadPKCEState(baseUrl: string): {
  codeVerifier: string | null;
  state: string | null;
} {
  return {
    codeVerifier: load(baseUrl, "pkce_verifier"),
    state: load(baseUrl, "pkce_state"),
  };
}

export function clearPKCEState(baseUrl: string) {
  remove(baseUrl, "pkce_verifier");
  remove(baseUrl, "pkce_state");
}

// ── Redirect URI ──

export function getRedirectUri(): string {
  return `${window.location.origin}/studio/oauth/callback`;
}

// ── Endpoint Health Check ──

export async function testEndpoint(
  url: string,
  method: string,
  onEvent: DebugEventCallback
): Promise<{ status: number; ok: boolean }> {
  try {
    const resp = await debugFetch(
      "endpoint_test",
      url,
      { method, headers: { Accept: "application/json" } },
      onEvent
    );
    return {
      status: resp.status,
      ok: resp.ok || resp.status === 302 || resp.status === 400,
    };
  } catch {
    return { status: 0, ok: false };
  }
}
