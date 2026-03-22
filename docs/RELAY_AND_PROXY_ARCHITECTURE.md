# mcpr Architecture

## Overview

mcpr is a single Rust binary that runs in three modes:

- **Tunnel mode** (default) — local MCP proxy + tunnel client through a relay server
- **No-tunnel mode** (`--no-tunnel` or `no_tunnel = true`) — local-only MCP proxy
- **Relay mode** (`--relay`) — public WebSocket relay server on a VPS

All configuration comes from CLI args or `mcpr.toml` — there are no hardcoded defaults. See `examples/` for sample configs.

## System Diagram

```
ChatGPT / Claude
    │
    │  HTTPS request to abc123.tunnel.example.com/mcp
    ▼
┌──────────────────────────────────────────────┐
│  VPS (tunnel.example.com)                    │
│                                              │
│  nginx (443 → 8081)                          │
│    ├── TLS termination (Let's Encrypt)       │
│    └── reverse proxy + WebSocket upgrade     │
│                                              │
│  mcpr --relay --port 8080                    │
│    ├── /_tunnel/register → WS registration   │
│    └── /*  (catch-all)   → route by Host     │
└──────────────────────┬───────────────────────┘
                       │
                  WebSocket
                  (persistent)
                       │
┌──────────────────────▼───────────────────────┐
│  Developer laptop                            │
│                                              │
│  mcpr (reads mcpr.toml)                      │
│                                              │
│  localhost:<port>                             │
│    ├── POST /mcp         → proxy to backend  │
│    ├── GET  /mcp         → SSE stream        │
│    ├── DELETE /mcp       → session terminate  │
│    ├── /.well-known/*    → OAuth metadata     │
│    └── /* (fallback)     → widget assets      │
│                                              │
│  Backend (:9000)     Widgets (:4444 or dist/) │
└──────────────────────────────────────────────┘
```

## Source Files

```
mcpr/src/
├── main.rs      App entry point, mode branching, server startup
├── config.rs    CLI parsing (clap), TOML loading, config merging
├── tunnel.rs    WebSocket relay server + tunnel client
├── proxy.rs     MCP proxy routes, SSE extraction, OAuth passthrough, resources/read interception
├── rewrite.rs   JSON response rewriting (widget domains, CSP injection, OAuth URLs)
├── widgets.rs   Widget fallback serving (proxy + static), HTML fetching with URL rewriting
└── display.rs   Terminal output (startup banner, single-line request logging)
```

### config.rs

Configuration loading with three layers: CLI args > TOML file > no defaults (required fields must be set).

**Structs:**
- `Cli` — clap-derived CLI parser with `--mcp`, `--widgets`, `--port`, `--csp`, `--relay`, `--relay-domain`, `--relay-url` (env: `MCPR_RELAY_URL`), `--no-tunnel`
- `FileConfig` — serde-derived TOML format with matching fields plus `tunnel_token` and `tunnel_subdomain`
- `ResolvedConfig` — merged result with all fields as `Option`. Required fields are validated at use site in `main.rs` with clear error messages

**Config file lookup:** Searches from current directory up through parent dirs for `mcpr.toml`. First valid file wins.

**Key methods:**
- `ResolvedConfig::load()` — parses CLI, loads TOML, merges (CLI wins over TOML)
- `ResolvedConfig::resolve_tunnel_identity()` — priority: `tunnel_subdomain` > `tunnel_token` > generate new UUID
- `ResolvedConfig::save_tunnel_token()` — persists auto-generated token back to `mcpr.toml`

### main.rs

Entry point. Calls `ResolvedConfig::load()`, then branches by mode:

- **Relay mode** (`--relay`) → validates `port` + `relay_domain` are set, calls `tunnel::start_relay()`
- **Client mode** (default) → validates `mcp` is set, resolves widget source, binds listener, optionally connects tunnel, builds `AppState`, starts axum server

`AppState` holds the upstream MCP URL, widget source, rewrite config, and shared HTTP client.

Port binding: in tunnel mode with no explicit port, uses port 0 (OS-assigned random port). In no-tunnel mode, `port` is required.

### tunnel.rs

Two independent subsystems in one file:

**Relay server** (`start_relay`):
- `/_tunnel/register` — WebSocket endpoint. Clients connect with `?token=TOKEN`, receive a `RegisterAck` with assigned subdomain/URL. Connection stays open for request forwarding.
- `/*` (fallback) — Extracts subdomain from `Host` header, finds matching tunnel, forwards HTTP request as JSON over WebSocket, waits for response.
- State: `HashMap<subdomain, TunnelConnection>` behind `RwLock`. Each connection has an `mpsc` channel and pending `oneshot` channels keyed by request ID.

**Tunnel client** (`start_tunnel_client`):
- Connects to relay via WebSocket at `wss://relay/_tunnel/register?token=TOKEN`
- Reads `RegisterAck` to get public URL
- Spawns background task: reads `TunnelRequest` messages, forwards each to `localhost:PORT` via reqwest, sends `TunnelResponse` back
- Returns public URL to caller

**Subdomain assignment:** `SHA256(token)[..6]` → 12 hex char subdomain. Same token always produces the same URL.

### proxy.rs

All MCP and OAuth proxy routes via a single fallback handler. Routing priority:

1. **Static widget assets** (file extension or Accept header check) → `serve_widget_asset`
2. **MCP JSON-RPC POST** (Content-Type: `application/json` + has `jsonrpc` field) → parse, intercept `resources/read`, rewrite response
3. **MCP SSE GET** (Accept: `text/event-stream`) → raw stream passthrough
4. **Everything else** (DELETE, `.well-known/*`, OAuth) → forward + rewrite URLs

**SSE handling:** Upstream MCP may return SSE-wrapped JSON (`data: {...}\n\n`). `extract_json_from_sse` unwraps it for rewriting, `wrap_as_sse` re-wraps after.

**`resources/read` interception:** When called for a `ui://widget/*` URI with a widget source configured, mcpr fetches HTML locally (dev server or static files), gets metadata from upstream, merges them, and rewrites URLs. Widgets load from the developer's machine while metadata comes from the backend.

**Response building:** Forwards `content-type`, `mcp-session-id`, `cache-control` headers. Rewrites `WWW-Authenticate` header to replace upstream URLs with proxy URLs for OAuth flows.

### rewrite.rs

JSON response rewriting to make widgets work through the tunnel:

- **`rewrite_response`** — dispatches by MCP method (`tools/list`, `tools/call`, `resources/list`, `resources/read`). Finds `meta` objects and rewrites widget metadata. Always runs `inject_proxy_into_all_csp` for deep scanning.
- **`rewrite_widget_meta`** — rewrites `openai/widgetDomain` → proxy domain, CSP arrays in both OpenAI (`openai/widgetCSP`) and Claude (`ui.csp`) formats
- **`inject_proxy_into_all_csp`** — recursive tree walk finding any CSP domain arrays anywhere in the JSON
- **`rewrite_csp_object`** — strips localhost/upstream domains, prepends proxy URL, appends extra CSP domains from config
- **`rewrite_oauth_metadata`** — replaces upstream MCP URL with proxy URL in OAuth discovery JSON

**What is never touched:** tool result content (`result.content[].text`), resource HTML text (`result.contents[].text`), any non-meta string values.

### widgets.rs

Widget serving via fallback route — any path not matched by proxy routes:

- **Proxy mode** (`widgets = "http://localhost:4444"`) — reverse proxy to dev server
- **Static mode** (`widgets = "../widgets/dist"`) — serve files from disk with MIME detection

`fetch_widget_html` fetches widget HTML for `resources/read` interception. Rewrites absolute paths (`"/..."`, `'/...'`) to use the tunnel URL so assets load through the proxy instead of the sandbox origin.

### display.rs

- `log_startup` — startup banner with proxy, tunnel, MCP, and widget URLs
- `log_request` — single-line request log: `HH:MM:SS METHOD /path [mcp_method] → STATUS (note) ↦ upstream`

## Configuration

All values must come from CLI args or `mcpr.toml`. No hardcoded defaults — missing required fields produce clear error messages.

| Field | CLI | TOML | Required | Notes |
|-------|-----|------|----------|-------|
| `mcp` | `--mcp` | `mcp` | Client mode | Upstream MCP server URL |
| `widgets` | `--widgets` | `widgets` | No | URL (proxy) or path (static) |
| `port` | `--port` | `port` | No-tunnel mode | Random port in tunnel mode if omitted |
| `relay_url` | `--relay-url` / `MCPR_RELAY_URL` | `relay_url` | Tunnel mode | Relay server URL |
| `relay_domain` | `--relay-domain` | `relay_domain` | Relay mode | Base domain for subdomains |
| `csp` | `--csp` (repeatable) | `csp` | No | Extra CSP domains |
| `no_tunnel` | `--no-tunnel` | `no_tunnel` | No | Disable tunnel |
| `relay` | `--relay` | — | No | Run as relay server |
| `tunnel_token` | — | `tunnel_token` | No | Auto-generated + saved if omitted |
| `tunnel_subdomain` | — | `tunnel_subdomain` | No | Fixed subdomain (overrides token) |

See `examples/` for sample configurations: `tunnel.toml`, `no-tunnel.toml`, `relay.toml`.

## Tunnel Protocol

All communication between relay and client uses JSON messages over a single WebSocket connection.

### Registration

```
Client → Relay:  WebSocket connect to /_tunnel/register?token=TOKEN
Relay → Client:  { "subdomain": "a1b2c3d4e5f6", "url": "https://a1b2c3d4e5f6.tunnel.example.com" }
```

### Request Forwarding

```
Relay → Client:  {
  "id": "uuid",
  "method": "POST",
  "path": "/mcp",
  "headers": { "content-type": "application/json", ... },
  "body": "base64-encoded-body"
}

Client → Relay:  {
  "id": "uuid",        // matches request
  "status": 200,
  "headers": { "content-type": "application/json", ... },
  "body": "base64-encoded-body"
}
```

Request bodies are base64-encoded. The `id` field correlates responses to requests (multiple requests can be in-flight concurrently via `oneshot` channels).

Timeout: 30 seconds per request. If the client disconnects, the relay removes the tunnel and returns 502 for subsequent requests to that subdomain.

## Data Flow

### POST /mcp — MCP JSON-RPC

```
Client (ChatGPT/Claude)
  │
  │  POST /mcp  { "method": "tools/call", ... }
  ▼
┌─ mcpr proxy ──────────────────────────────────────────────────────┐
│                                                                   │
│  1. Parse request body as JSON to extract MCP method name         │
│     (if not valid JSON → forward raw, no processing)              │
│                                                                   │
│  2. resources/read interception (only when widget_source is set)  │
│     - Match ui://widget/* URIs                                    │
│     - Fetch HTML from local widget source                         │
│     - Forward to upstream for metadata                            │
│     - Replace upstream HTML with local HTML                       │
│     - Rewrite meta (CSP, domains)                                 │
│     - Return directly (skip steps 3-5)                            │
│                                                                   │
│  3. Forward request to upstream MCP server (unchanged)            │
│                                                                   │
│  4. Collect upstream response                                     │
│     - Upstream may return raw JSON or SSE-wrapped                 │
│     - extract_json_from_sse() detects + unwraps SSE format        │
│                                                                   │
│  5. Rewrite response JSON (rewrite_response):                     │
│     ┌─────────────────────────────────────────────────────┐       │
│     │ What gets rewritten:                                │       │
│     │  • meta.openai/widgetDomain → proxy domain          │       │
│     │  • meta.openai/widgetCSP.resource_domains           │       │
│     │  • meta.openai/widgetCSP.connect_domains            │       │
│     │  • meta.ui.csp.connectDomains (Claude format)       │       │
│     │  • meta.ui.csp.resourceDomains (Claude format)      │       │
│     │  • Deep scan: any CSP domain arrays in the JSON     │       │
│     │  • WWW-Authenticate header (OAuth)                  │       │
│     │                                                     │       │
│     │ What is NEVER touched:                              │       │
│     │  • Tool result content (result.content[].text)      │       │
│     │  • Resource HTML text (result.contents[].text)      │       │
│     │  • Any non-meta string values                       │       │
│     └─────────────────────────────────────────────────────┘       │
│                                                                   │
│  6. If response was SSE → re-wrap as SSE after rewriting          │
│     Return to client                                              │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### GET /mcp — SSE Stream

```
Client  ──GET /mcp──►  mcpr  ──GET /mcp──►  Upstream MCP server
         ◄── SSE stream passthrough (no parsing, no buffering) ──
```

The long-lived SSE stream is proxied as a raw byte stream. No JSON parsing or rewriting — streamed directly for low latency.

### OAuth Discovery

```
Client  ──GET /.well-known/oauth-authorization-server──►  mcpr  ──►  Upstream
         ◄── JSON response with all upstream URLs replaced by proxy URLs ──
```

Uses `rewrite_oauth_metadata()` — recursive string replacement of the upstream MCP URL with the proxy URL in all JSON string values.

### Widget Asset Serving

```
Client  ──GET /assets/main.js──►  mcpr widget fallback
                                    ├── Proxy mode:  forward to widget dev server
                                    ├── Static mode:  read from dist directory
                                    └── No source:   404
```

Files served as-is with appropriate MIME types. No rewriting.

### Standalone Proxy Mode (no widgets)

When running without `--widgets`, mcpr works as a pure MCP tunnel:

- All `/mcp` requests are forwarded with CSP/OAuth rewriting
- `resources/read` interception is skipped (no local widget source)
- Upstream HTML in `contents[].text` passes through untouched
- Only `meta` objects and CSP arrays are rewritten
- Widget asset fallback returns 404

This mode works with any MCP server that already includes widget HTML in its `resources/read` responses.

## Dependencies

| Crate | Purpose |
|-------|---------|
| `axum` (+ `ws`) | HTTP server, WebSocket support |
| `tokio` | Async runtime |
| `tokio-tungstenite` | WebSocket client (tunnel client → relay) |
| `reqwest` | HTTP client (upstream MCP + widget forwarding) |
| `clap` | CLI argument parsing with env var support |
| `serde` / `serde_json` | JSON serialization |
| `sha2` | Token → subdomain hashing |
| `base64` | Encoding request/response bodies in tunnel protocol |
| `uuid` | Request IDs + auto-generated tunnel tokens |
| `futures-util` | Stream splitting for WebSocket read/write |
| `tower-http` | CORS middleware |
| `colored` | Terminal output coloring |
| `chrono` | Timestamps in request logs |
| `toml` | Config file parsing |
