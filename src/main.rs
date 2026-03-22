mod config;
mod display;
mod proxy;
mod rewrite;
mod tui;
mod tunnel;
mod widgets;

use std::sync::Arc;
use tokio::sync::RwLock;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};

use config::ResolvedConfig;
use display::log_startup;
use proxy::proxy_routes;
use rewrite::RewriteConfig;
use tui::SharedTuiState;
use widgets::WidgetSource;

#[derive(Clone)]
pub struct AppState {
    pub mcp_upstream: String,
    pub widget_source: Option<WidgetSource>,
    pub rewrite_config: Arc<RwLock<RewriteConfig>>,
    pub http_client: reqwest::Client,
    pub tui_state: SharedTuiState,
}

#[tokio::main]
async fn main() {
    let cfg = ResolvedConfig::load();

    // Relay mode: just run the relay server
    if cfg.relay {
        let port = cfg.port.expect("port is required in mcpr.toml or --port");
        let relay_domain = cfg
            .relay_domain
            .expect("relay_domain is required in mcpr.toml or --relay-domain");
        tunnel::start_relay(port, relay_domain).await;
        return;
    }

    // Client mode: local proxy + tunnel
    let tui_state = tui::new_shared_state();

    let mcp = cfg.mcp.expect("mcp is required in mcpr.toml or --mcp");

    let widget_source = cfg.widgets.as_ref().map(|w| {
        if w.starts_with("http://") || w.starts_with("https://") {
            WidgetSource::Proxy(w.clone())
        } else {
            WidgetSource::Static(w.clone())
        }
    });

    // Bind listener first — in tunnel mode with no explicit port, use port 0 (random)
    let bind_port = if !cfg.no_tunnel && cfg.port.is_none() {
        0
    } else {
        cfg.port.expect("port is required in mcpr.toml or --port")
    };
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{bind_port}"))
        .await
        .expect("Failed to bind");
    let actual_port = listener.local_addr().unwrap().port();

    // Determine public URL
    let public_url = if cfg.no_tunnel {
        // No tunnel — mark as connected (local-only)
        tui_state.lock().unwrap().tunnel_status = tui::ConnectionStatus::Connected;
        format!("http://localhost:{actual_port}")
    } else {
        let relay_url = cfg
            .relay_url
            .as_deref()
            .expect("relay_url is required in mcpr.toml or --relay-url");
        let config_path = cfg.config_path.clone();
        let (token, desired_subdomain) =
            ResolvedConfig::resolve_tunnel_identity(cfg.tunnel_subdomain, cfg.tunnel_token, || {
                let new_token = uuid::Uuid::new_v4().to_string();
                if let Some(path) = &config_path {
                    ResolvedConfig::save_tunnel_token(path, &new_token);
                }
                new_token
            });

        tui_state.lock().unwrap().tunnel_status = tui::ConnectionStatus::Connecting;

        match tunnel::start_tunnel_client(
            actual_port,
            relay_url,
            &token,
            desired_subdomain.as_deref(),
            tui_state.clone(),
        )
        .await
        {
            Ok(url) => url,
            Err(e) => {
                eprintln!(
                    "{}: Failed to connect to relay: {}",
                    colored::Colorize::red("error"),
                    e
                );
                eprintln!("Use --no-tunnel for local-only mode");
                std::process::exit(1);
            }
        }
    };

    let proxy_domain = public_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();

    let rewrite_config = RewriteConfig {
        proxy_url: public_url.clone(),
        proxy_domain,
        mcp_upstream: mcp.clone(),
        extra_csp_domains: cfg.csp_domains.clone(),
    };

    let state = AppState {
        mcp_upstream: mcp.clone(),
        widget_source,
        rewrite_config: Arc::new(RwLock::new(rewrite_config)),
        http_client: reqwest::Client::new(),
        tui_state: tui_state.clone(),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(Any);

    let health_state = state.clone();

    let app: Router<AppState> = Router::new();
    let app = proxy_routes(app);
    let app = app.with_state(state).layer(cors);

    log_startup(
        &tui_state,
        actual_port,
        &public_url,
        &mcp,
        cfg.widgets.as_deref(),
    );

    // Spawn the axum server as a background task
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("Server failed");
    });

    // Spawn health check task: periodically probe MCP + widgets status
    {
        tokio::spawn(async move {
            health_check_loop(health_state).await;
        });
    }

    // Run the TUI on a blocking thread (it reads stdin)
    let tui_handle = tokio::task::spawn_blocking(move || {
        tui::run(tui_state).expect("TUI failed");
    });

    tui_handle.await.unwrap();
}

/// Periodically check MCP upstream and widget source connectivity.
async fn health_check_loop(app_state: AppState) {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    loop {
        // Check MCP upstream
        let mcp_status = match http.get(&app_state.mcp_upstream).send().await {
            Ok(_) => tui::ConnectionStatus::Connected,
            Err(_) => tui::ConnectionStatus::Disconnected,
        };

        // Discover widgets (reuses shared logic from widgets.rs)
        let names = widgets::discover_widget_names(&app_state).await;
        let widgets_status = if app_state.widget_source.is_none() {
            tui::ConnectionStatus::Unknown
        } else if names.is_empty() {
            tui::ConnectionStatus::Disconnected
        } else {
            tui::ConnectionStatus::Connected
        };
        let widget_count = if names.is_empty() {
            None
        } else {
            Some(names.len())
        };

        {
            let mut s = app_state.tui_state.lock().unwrap();
            s.mcp_status = mcp_status;
            s.widgets_status = widgets_status;
            s.widget_count = widget_count;
            s.widget_names = names;
        }

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
}
