use clap::Parser;

use crate::relay::config::RelayConfig;

const CONFIG_FILE: &str = "mcpr.toml";

// ── Run mode ────────────────────────────────────────────────────────────

/// Top-level mode: either run as a relay server or as the gateway proxy.
pub enum Mode {
    Relay(RelayConfig),
    Gateway(GatewayConfig),
}

// ── CSP rewriting ───────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CspMode {
    /// Keep external domains from upstream, strip localhost, add configured extras + tunnel domain
    #[default]
    Extend,
    /// Ignore upstream CSP entirely, use only configured domains + tunnel domain
    Override,
}

impl std::fmt::Display for CspMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CspMode::Extend => write!(f, "extend"),
            CspMode::Override => write!(f, "override"),
        }
    }
}

fn parse_csp_mode(s: &str) -> CspMode {
    match s.to_lowercase().as_str() {
        "override" => CspMode::Override,
        _ => CspMode::Extend,
    }
}

// ── CLI args ────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "mcpr", about = "MCP proxy with widget serving and tunnel")]
struct Cli {
    /// Upstream MCP server URL
    #[arg(long)]
    mcp: Option<String>,

    /// Widget source: URL (proxy mode) or path (static mode)
    #[arg(long)]
    widgets: Option<String>,

    /// Local proxy port
    #[arg(long)]
    port: Option<u16>,

    /// Extra CSP domains
    #[arg(long = "csp")]
    csp_domains: Vec<String>,

    /// CSP mode: "extend" (add to upstream CSP) or "override" (replace upstream CSP)
    #[arg(long = "csp-mode")]
    csp_mode: Option<String>,

    /// Run as relay server instead of client proxy
    #[arg(long)]
    relay: bool,

    /// Relay server base domain (for relay mode)
    #[arg(long)]
    relay_domain: Option<String>,

    /// Auth provider URL for token validation (relay mode)
    #[arg(long, env = "MCPR_AUTH_PROVIDER")]
    auth_provider: Option<String>,

    /// Shared secret between relay and auth provider
    #[arg(long, env = "MCPR_AUTH_PROVIDER_SECRET")]
    auth_provider_secret: Option<String>,

    /// Relay server URL (for gateway tunnel mode)
    #[arg(long, env = "MCPR_RELAY_URL")]
    relay_url: Option<String>,

    /// Don't start any tunnel (local-only mode)
    #[arg(long)]
    no_tunnel: bool,
}

// ── TOML config file ────────────────────────────────────────────────────

/// `[csp]` table in config file
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct FileCspConfig {
    mode: Option<String>,
    domains: Vec<String>,
}

/// `[relay]` table in config file
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct FileRelayConfig {
    domain: Option<String>,
    auth_provider: Option<String>,
    auth_provider_secret: Option<String>,
}

/// `[tunnel]` table in config file
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct FileTunnelConfig {
    relay_url: Option<String>,
    token: Option<String>,
    subdomain: Option<String>,
}

/// Config file format (mcpr.toml)
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct FileConfig {
    // -- Shared --
    port: Option<u16>,
    mode: Option<String>, // "relay" | "gateway" (default)

    // -- Gateway --
    mcp: Option<String>,
    widgets: Option<String>,
    no_tunnel: bool,
    csp: FileCspConfig,

    // -- Relay --
    relay: FileRelayConfig,

    // -- Tunnel client --
    tunnel: FileTunnelConfig,

    // -- Legacy flat fields (backward compat) --
    relay_domain: Option<String>,
    relay_url: Option<String>,
    tunnel_token: Option<String>,
    tunnel_subdomain: Option<String>,
}

impl FileConfig {
    /// Load config from mcpr.toml, searching current dir then parent dirs.
    fn load() -> (Self, Option<std::path::PathBuf>) {
        let mut dir = std::env::current_dir().ok();
        while let Some(d) = dir {
            let path = d.join(CONFIG_FILE);
            if path.exists()
                && let Ok(contents) = std::fs::read_to_string(&path)
            {
                match toml::from_str::<FileConfig>(&contents) {
                    Ok(config) => {
                        eprintln!(
                            "  {} loaded {}",
                            colored::Colorize::dimmed("config"),
                            path.display()
                        );
                        return (config, Some(path));
                    }
                    Err(e) => {
                        eprintln!(
                            "  {}: failed to parse {}: {}",
                            colored::Colorize::yellow("warn"),
                            path.display(),
                            e
                        );
                    }
                }
            }
            dir = d.parent().map(|p| p.to_path_buf());
        }
        (FileConfig::default(), None)
    }

    /// Resolve relay domain: [relay].domain > relay_domain (legacy)
    fn relay_domain(&self) -> Option<String> {
        self.relay.domain.clone().or(self.relay_domain.clone())
    }

    /// Resolve tunnel relay URL: [tunnel].relay_url > relay_url (legacy)
    fn tunnel_relay_url(&self) -> Option<String> {
        self.tunnel.relay_url.clone().or(self.relay_url.clone())
    }

    /// Resolve tunnel token: [tunnel].token > tunnel_token (legacy)
    fn tunnel_token(&self) -> Option<String> {
        self.tunnel.token.clone().or(self.tunnel_token.clone())
    }

    /// Resolve tunnel subdomain: [tunnel].subdomain > tunnel_subdomain (legacy)
    fn tunnel_subdomain(&self) -> Option<String> {
        self.tunnel
            .subdomain
            .clone()
            .or(self.tunnel_subdomain.clone())
    }

    /// Is relay mode via config file: mode = "relay"
    fn is_relay(&self) -> bool {
        self.mode.as_deref() == Some("relay")
    }
}

// ── Gateway config ──────────────────────────────────────────────────────

/// Resolved configuration for gateway (proxy) mode.
pub struct GatewayConfig {
    pub mcp: Option<String>,
    pub widgets: Option<String>,
    pub port: Option<u16>,
    pub csp_domains: Vec<String>,
    pub csp_mode: CspMode,
    pub relay_url: Option<String>,
    pub tunnel_token: Option<String>,
    pub tunnel_subdomain: Option<String>,
    pub no_tunnel: bool,
    pub config_path: Option<std::path::PathBuf>,
}

impl GatewayConfig {
    /// Resolve tunnel identity from config.
    /// Priority: tunnel_subdomain > tunnel_token > generate new.
    /// Returns (token, desired_subdomain).
    pub fn resolve_tunnel_identity(
        tunnel_subdomain: Option<String>,
        tunnel_token: Option<String>,
        generate_token: impl FnOnce() -> String,
    ) -> (String, Option<String>) {
        if let Some(sub) = tunnel_subdomain {
            return (sub.clone(), Some(sub));
        }
        let token = tunnel_token.unwrap_or_else(generate_token);
        (token, None)
    }

    /// Append tunnel token to the config file so the URL persists across restarts.
    pub fn save_tunnel_token(path: &std::path::Path, token: &str) {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                // Check for new [tunnel] table format first
                if contents.contains("[tunnel]") {
                    if contents.contains("token =") || contents.contains("token=") {
                        return; // already set
                    }
                    // Insert token under [tunnel] section
                    let new_contents =
                        contents.replacen("[tunnel]", &format!("[tunnel]\ntoken = \"{token}\""), 1);
                    if let Err(e) = std::fs::write(path, new_contents) {
                        eprintln!(
                            "  {}: failed to save tunnel token to {}: {}",
                            colored::Colorize::yellow("warn"),
                            path.display(),
                            e
                        );
                    } else {
                        eprintln!(
                            "  {} saved tunnel token to {}",
                            colored::Colorize::dimmed("config"),
                            path.display()
                        );
                    }
                    return;
                }

                // Legacy flat format
                if contents.contains("# tunnel_token") {
                    let new_contents = contents.replacen(
                        &contents
                            .lines()
                            .find(|l| l.contains("# tunnel_token"))
                            .unwrap_or("# tunnel_token = \"\"")
                            .to_string(),
                        &format!("tunnel_token = \"{token}\""),
                        1,
                    );
                    if let Err(e) = std::fs::write(path, new_contents) {
                        eprintln!(
                            "  {}: failed to save tunnel_token to {}: {}",
                            colored::Colorize::yellow("warn"),
                            path.display(),
                            e
                        );
                    } else {
                        eprintln!(
                            "  {} saved tunnel_token to {}",
                            colored::Colorize::dimmed("config"),
                            path.display()
                        );
                    }
                } else if !contents.contains("tunnel_token") {
                    let new_contents =
                        format!("{}\ntunnel_token = \"{token}\"\n", contents.trim_end());
                    if let Err(e) = std::fs::write(path, new_contents) {
                        eprintln!(
                            "  {}: failed to save tunnel_token to {}: {}",
                            colored::Colorize::yellow("warn"),
                            path.display(),
                            e
                        );
                    } else {
                        eprintln!(
                            "  {} saved tunnel_token to {}",
                            colored::Colorize::dimmed("config"),
                            path.display()
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "  {}: failed to read {}: {}",
                    colored::Colorize::yellow("warn"),
                    path.display(),
                    e
                );
            }
        }
    }
}

// ── Load + dispatch ─────────────────────────────────────────────────────

/// Parse CLI args, load config file, and return the resolved mode.
pub fn load() -> Mode {
    let cli = Cli::parse();
    let (file, config_path) = FileConfig::load();

    let is_relay = cli.relay || file.is_relay();

    if is_relay {
        let port = cli
            .port
            .or(file.port)
            .expect("port is required for relay mode (--port or port in mcpr.toml)");
        let relay_domain = cli.relay_domain.or(file.relay_domain()).expect(
            "relay domain is required for relay mode (--relay-domain or [relay].domain in mcpr.toml)",
        );
        let auth_provider = cli.auth_provider.or(file.relay.auth_provider);
        let auth_provider_secret = cli.auth_provider_secret.or(file.relay.auth_provider_secret);

        Mode::Relay(RelayConfig {
            port,
            relay_domain,
            auth_provider,
            auth_provider_secret,
        })
    } else {
        // Resolve values from file before consuming fields
        let tunnel_relay_url = file.tunnel_relay_url();
        let tunnel_token = file.tunnel_token();
        let tunnel_subdomain = file.tunnel_subdomain();

        let csp_domains = if cli.csp_domains.is_empty() {
            file.csp.domains
        } else {
            cli.csp_domains
        };

        let csp_mode = if let Some(m) = &cli.csp_mode {
            parse_csp_mode(m)
        } else if let Some(m) = &file.csp.mode {
            parse_csp_mode(m)
        } else {
            CspMode::default()
        };

        Mode::Gateway(GatewayConfig {
            mcp: cli.mcp.or(file.mcp),
            widgets: cli.widgets.or(file.widgets),
            port: cli.port.or(file.port),
            csp_domains,
            csp_mode,
            relay_url: cli.relay_url.or(tunnel_relay_url),
            tunnel_token,
            tunnel_subdomain,
            no_tunnel: cli.no_tunnel || file.no_tunnel,
            config_path,
        })
    }
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdomain_takes_priority_over_token() {
        let (token, sub) = GatewayConfig::resolve_tunnel_identity(
            Some("673977ba420f".into()),
            Some("90c74def-8fdc-4922-8702-44bc5cabf830".into()),
            || panic!("should not generate"),
        );
        assert_eq!(token, "673977ba420f");
        assert_eq!(sub.as_deref(), Some("673977ba420f"));
    }

    #[test]
    fn subdomain_without_token() {
        let (token, sub) =
            GatewayConfig::resolve_tunnel_identity(Some("abcdef123456".into()), None, || {
                panic!("should not generate")
            });
        assert_eq!(token, "abcdef123456");
        assert_eq!(sub.as_deref(), Some("abcdef123456"));
    }

    #[test]
    fn no_subdomain_uses_token() {
        let (token, sub) =
            GatewayConfig::resolve_tunnel_identity(None, Some("my-saved-token".into()), || {
                panic!("should not generate")
            });
        assert_eq!(token, "my-saved-token");
        assert_eq!(sub, None);
    }

    #[test]
    fn no_subdomain_no_token_generates() {
        let (token, sub) =
            GatewayConfig::resolve_tunnel_identity(None, None, || "generated-uuid".into());
        assert_eq!(token, "generated-uuid");
        assert_eq!(sub, None);
    }
}
