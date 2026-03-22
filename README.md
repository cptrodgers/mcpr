# mcpr

MCPR proxy with widget serving and built-in tunneling. One command to expose your local MCP server + widgets to ChatGPT/Claude via a public HTTPS URL.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/nichochar/mcpr/main/scripts/install.sh | sh
```

Or build from source:
```bash
cargo install --path .
```

## Quick Start

```bash
mcpr
```

On first run, mcpr generates a stable tunnel URL and saves the token to `mcpr.toml`:

The tunnel URL stays the same across restarts. Delete `tunnel_token` from `mcpr.toml` to regenerate.

## How It Works

```
ChatGPT / Claude
    │
    ▼
Relay (tunnel)  ←── WebSocket ──→  mcpr (local)
                                      ├── POST /mcp       → upstream MCP, rewrite response
                                      ├── GET  /mcp       → SSE stream passthrough
                                      ├── DELETE /mcp     → session termination
                                      ├── /.well-known/*  → passthrough to upstream
                                      └── /* (fallback)   → widget assets
```

mcpr sits between AI clients and your local MCP server. It proxies JSON-RPC requests, rewrites widget metadata (domains, CSP) for the tunnel URL, handles SSE streams, and serves widget assets as a fallback route.

## Configuration

mcpr looks for `mcpr.toml` in the current directory (then parent dirs). See [`config_examples/`](config_examples/) for ready-to-use templates.

```toml
mcp = "http://localhost:9000"
widgets = "http://localhost:4444"
port = 3000
```

Priority: **CLI args > environment variables > mcpr.toml > defaults**

## CLI

```
mcpr [OPTIONS]

Options:
  --mcp <URL>              Upstream MCP server (required)
  --widgets <URL|PATH>     Widget source (URL = proxy, PATH = static serve)
  --port <PORT>            Local proxy port (required in local/relay mode, random in tunnel mode)
  --csp <DOMAIN>           Extra CSP domains (repeatable)
  --relay-url <URL>        Custom relay server (env: MCPR_RELAY_URL)
  --no-tunnel              Local-only, no tunnel
  --relay                  Run as relay server
  --relay-domain <DOMAIN>  Relay base domain (required in relay mode)
```

## Modes

**Tunnel** (default) — Connects to a relay, gets a public HTTPS URL. Token is auto-generated and saved for stable URLs across restarts.

**Local-only** — No tunnel. For local clients (Claude Desktop, VS Code, Cursor):
```bash
mcpr --no-tunnel
# Client connects to http://localhost:3000/mcp
```

**Static widgets** — Serve pre-built widgets from disk instead of proxying a dev server:
```bash
mcpr --widgets ./widgets/dist
```

**Relay** — Self-host your own tunnel relay. Requires wildcard DNS and TLS termination:
```bash
mcpr --relay --port 8080 --relay-domain tunnel.yourdomain.com
```

See [docs/DEPLOY_RELAY_SERVER.md](docs/DEPLOY_RELAY_SERVER.md) for full relay setup instructions.

## Usage with AI Clients

**ChatGPT**: Settings → Apps → Add app → paste your tunnel URL

**claude.ai**: Add tunnel URL as MCP endpoint

**Claude Desktop** (local):
```json
{
  "mcpServers": {
    "my-app": { "url": "http://localhost:3000/mcp" }
  }
}
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
