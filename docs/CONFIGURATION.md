# Configuration Reference

mcpr uses `mcpr.toml` for configuration. It searches the current directory, then parent directories. CLI args and environment variables override config file values.

**Priority:** CLI args > environment variables > `mcpr.toml` > defaults

## Modes

mcpr runs in one of two modes:

| Mode | Trigger | Purpose |
|------|---------|---------|
| **Gateway** (default) | No `--relay` flag | Proxy + tunnel client for local MCP development |
| **Relay** | `--relay` flag or `mode = "relay"` in config | Tunnel relay server deployed on a VPS |

## Gateway Mode

### Minimal

```toml
mcp = "http://localhost:9000"
```

### Full example

```toml
# Upstream MCP server (required)
mcp = "http://localhost:9000/mcp"

# Widget source: URL (proxy to dev server) or file path (static serve)
widgets = "http://localhost:4444"

# Local proxy port (optional in tunnel mode -- picks random port if omitted)
port = 3000

# Disable tunnel -- local-only mode
no_tunnel = false

[tunnel]
# Relay server URL (default: https://tunnel.mcpr.app)
relay_url = "https://tunnel.mcpr.app"

# Persistent tunnel identity (auto-generated and saved on first run)
token = "90c74def-8fdc-4922-8702-44bc5cabf830"

# Fixed subdomain (optional -- derived from token if omitted)
subdomain = "myapp"

[csp]
# CSP rewriting mode: "extend" (default) or "override"
mode = "extend"

# Additional CSP domains to allow
domains = ["https://media.mcpr.app", "https://api.example.com"]
```

### Field reference

| Field | CLI | Env | Description |
|-------|-----|-----|-------------|
| `mcp` | `--mcp` | | Upstream MCP server URL |
| `widgets` | `--widgets` | | Widget source: URL or file path |
| `port` | `--port` | | Local proxy port |
| `no_tunnel` | `--no-tunnel` | | Disable tunnel (local-only mode) |
| `[tunnel].relay_url` | `--relay-url` | `MCPR_RELAY_URL` | Relay server URL |
| `[tunnel].token` | | | Tunnel authentication token |
| `[tunnel].subdomain` | | | Fixed subdomain for tunnel |
| `[csp].mode` | `--csp-mode` | | `"extend"` or `"override"` |
| `[csp].domains` | `--csp` | | Extra CSP domains (repeatable via CLI) |

## Relay Mode

### Minimal (open -- no auth)

```toml
mode = "relay"
port = 8081

[relay]
domain = "tunnel.yourdomain.com"
```

### With static tokens

```toml
mode = "relay"
port = 8081

[relay]
domain = "tunnel.yourdomain.com"

[[relay.tokens]]
token = "mcpr_abc123"
subdomains = ["myapp", "myapp-*"]

[[relay.tokens]]
token = "mcpr_def456"
subdomains = ["other-app", "other-app-*"]
```

### With auth provider

```toml
mode = "relay"
port = 8081

[relay]
domain = "tunnel.yourdomain.com"
auth_provider = "https://auth.yourdomain.com"
auth_provider_secret = "your-shared-secret-here"
```

### Field reference

| Field | CLI | Env | Description |
|-------|-----|-----|-------------|
| `mode` | `--relay` | | Set to `"relay"` to run as relay server |
| `port` | `--port` | | Port the relay listens on |
| `[relay].domain` | `--relay-domain` | | Base domain for tunnel subdomains |
| `[relay].auth_provider` | `--auth-provider` | `MCPR_AUTH_PROVIDER` | External auth provider URL |
| `[relay].auth_provider_secret` | `--auth-provider-secret` | `MCPR_AUTH_PROVIDER_SECRET` | Shared secret for auth provider |
| `[[relay.tokens]]` | | | Static token entries (see below) |

### Auth modes

The relay supports three auth modes (pick one):

| Mode | Config | When to use |
|------|--------|-------------|
| **Open** | No tokens, no auth_provider | Local dev, testing |
| **Static tokens** | `[[relay.tokens]]` entries | Small team, simple setup |
| **Auth provider** | `[relay].auth_provider` URL | Dynamic token management at scale |

Priority: static tokens > auth provider > open.

### Static token format

```toml
[[relay.tokens]]
token = "mcpr_abc123"           # the token clients use
subdomains = ["myapp", "myapp-*"]  # allowed subdomain patterns
```

### Subdomain patterns

Patterns support glob-style `*` wildcard:

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `myapp` | `myapp` | `myapp-dev` |
| `myapp-*` | `myapp-dev`, `myapp-feat-123` | `myapp` |
| `*-preview` | `feat-preview`, `hotfix-preview` | `preview` |
| `pr-*-acme` | `pr-123-acme`, `pr-abc-acme` | `pr-123` |
| `*` | anything | |

## Backward Compatibility

Legacy flat fields from older config files are still supported:

| Legacy field | New location |
|-------------|--------------|
| `relay_domain` | `[relay].domain` |
| `relay_url` | `[tunnel].relay_url` |
| `tunnel_token` | `[tunnel].token` |
| `tunnel_subdomain` | `[tunnel].subdomain` |

The new grouped format is recommended for new configs. See [`config_examples/`](../config_examples/) for templates.

## Related docs

- [Deploy Relay Server](DEPLOY_RELAY_SERVER.md) -- VPS setup, DNS, TLS, nginx/Caddy
- [Static Tokens](STATIC_TOKENS.md) -- practical guide for static token auth (team setup, CI/CD, demos)
- [Auth Provider](AUTH_PROVIDER.md) -- building an external auth provider API
