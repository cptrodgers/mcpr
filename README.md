# mcpr

Development proxy for MCP apps with widgets. One command to connect your local MCP backend + widget frontend to ChatGPT and Claude.

## Why mcpr?

Building an MCP app typically means two separate servers: a **backend** (MCP server handling tools/resources) and a **frontend** (widgets rendered inside the AI client). During development, these run locally — but ChatGPT and Claude need a public HTTPS URL to reach them.

mcpr solves this by sitting between your local servers and the AI client:

- **Proxies MCP requests** to your backend and **serves widgets** from your frontend — through a single URL
- **Tunnels automatically** — no ngrok, no port forwarding, no deploy-to-test cycles
- **Rewrites domains and CSP** so widgets load correctly through the tunnel
- **Stable URL** across restarts — configure once in ChatGPT/Claude, keep developing
- **Studio** — test widgets locally with mock data before connecting to any AI client

```
Your machine                          AI client (ChatGPT / Claude)
┌─────────────────┐
│ MCP backend     │◄──┐
│ (localhost:9000) │   │
└─────────────────┘   │
                      │   mcpr        tunnel
┌─────────────────┐   ├──────────── ◄──────────── https://xxx.tunnel.example.com
│ Widget frontend │◄──┘
│ (localhost:4444) │
└─────────────────┘
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/nichochar/mcpr/main/scripts/install.sh | sh
```

Or build from source:
```bash
cargo install --path .
```

## Quick Start

Point mcpr at your MCP backend and widget frontend:

```toml
# mcpr.toml
mcp = "http://localhost:9000"
widgets = "http://localhost:4444"
```

```bash
mcpr
```

On first run, mcpr generates a stable tunnel URL and saves the token to `mcpr.toml`. Paste the URL in ChatGPT or Claude — it stays the same across restarts.

## Configuration

mcpr looks for `mcpr.toml` in the current directory (then parent dirs). See [`config_examples/`](config_examples/) for ready-to-use templates.

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

## Studio

mcpr includes a built-in widget debugger at `/studio/`. Preview widgets, edit mock `toolInput`/`toolOutput` as JSON, switch between OpenAI and Claude platform simulation, and inspect every action your widget fires — all without connecting to a real AI client.

See [docs/STUDIO.md](docs/STUDIO.md) for details.

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
