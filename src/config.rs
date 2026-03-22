use clap::Parser;

const CONFIG_FILE: &str = "mcpr.toml";

#[derive(Parser)]
#[command(name = "mcpr", about = "MCP proxy with widget serving and tunnel")]
pub struct Cli {
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

    /// Run as relay server instead of client proxy
    #[arg(long)]
    relay: bool,

    /// Relay server base domain (for relay mode)
    #[arg(long)]
    relay_domain: Option<String>,

    /// Relay server URL
    #[arg(long, env = "MCPR_RELAY_URL")]
    relay_url: Option<String>,

    /// Don't start any tunnel (local-only mode)
    #[arg(long)]
    no_tunnel: bool,
}

/// Config file format (mcpr.toml)
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct FileConfig {
    mcp: Option<String>,
    widgets: Option<String>,
    port: Option<u16>,
    csp: Vec<String>,
    relay_domain: Option<String>,
    relay_url: Option<String>,
    tunnel_token: Option<String>,
    tunnel_subdomain: Option<String>,
    no_tunnel: bool,
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
}

/// Resolved configuration: CLI args override config file, which overrides defaults.
pub struct ResolvedConfig {
    pub mcp: Option<String>,
    pub widgets: Option<String>,
    pub port: Option<u16>,
    pub csp_domains: Vec<String>,
    pub relay: bool,
    pub relay_domain: Option<String>,
    pub relay_url: Option<String>,
    pub tunnel_token: Option<String>,
    pub tunnel_subdomain: Option<String>,
    pub no_tunnel: bool,
    pub config_path: Option<std::path::PathBuf>,
}

impl ResolvedConfig {
    /// Parse CLI args, load config file, and merge into a resolved config.
    pub fn load() -> Self {
        let cli = Cli::parse();
        let (file_config, config_path) = FileConfig::load();

        let csp_domains = if cli.csp_domains.is_empty() {
            file_config.csp
        } else {
            cli.csp_domains
        };

        Self {
            mcp: cli.mcp.or(file_config.mcp),
            widgets: cli.widgets.or(file_config.widgets),
            port: cli.port.or(file_config.port),
            csp_domains,
            relay: cli.relay,
            relay_domain: cli.relay_domain.or(file_config.relay_domain),
            relay_url: cli.relay_url.or(file_config.relay_url),
            tunnel_token: file_config.tunnel_token,
            tunnel_subdomain: file_config.tunnel_subdomain,
            no_tunnel: cli.no_tunnel || file_config.no_tunnel,
            config_path,
        }
    }

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

    /// Append tunnel_token to the config file so the URL persists across restarts.
    pub fn save_tunnel_token(path: &std::path::Path, token: &str) {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                let new_contents = if contents.contains("# tunnel_token") {
                    contents.replacen(
                        &contents
                            .lines()
                            .find(|l| l.contains("# tunnel_token"))
                            .unwrap_or("# tunnel_token = \"\"")
                            .to_string(),
                        &format!("tunnel_token = \"{token}\""),
                        1,
                    )
                } else if contents.contains("tunnel_token") {
                    return;
                } else {
                    format!("{}\ntunnel_token = \"{token}\"\n", contents.trim_end())
                };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdomain_takes_priority_over_token() {
        let (token, sub) = ResolvedConfig::resolve_tunnel_identity(
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
            ResolvedConfig::resolve_tunnel_identity(Some("abcdef123456".into()), None, || {
                panic!("should not generate")
            });
        assert_eq!(token, "abcdef123456");
        assert_eq!(sub.as_deref(), Some("abcdef123456"));
    }

    #[test]
    fn no_subdomain_uses_token() {
        let (token, sub) =
            ResolvedConfig::resolve_tunnel_identity(None, Some("my-saved-token".into()), || {
                panic!("should not generate")
            });
        assert_eq!(token, "my-saved-token");
        assert_eq!(sub, None);
    }

    #[test]
    fn no_subdomain_no_token_generates() {
        let (token, sub) =
            ResolvedConfig::resolve_tunnel_identity(None, None, || "generated-uuid".into());
        assert_eq!(token, "generated-uuid");
        assert_eq!(sub, None);
    }
}
