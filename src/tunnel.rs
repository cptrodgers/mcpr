use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{RwLock, oneshot};

// ── Protocol messages ────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct TunnelRequest {
    id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>, // base64
}

#[derive(Serialize, Deserialize)]
struct TunnelResponse {
    id: String,
    status: u16,
    headers: HashMap<String, String>,
    body: Option<String>, // base64
}

#[derive(Serialize, Deserialize)]
struct RegisterAck {
    subdomain: String,
    url: String,
}

// ── Relay server ─────────────────────────────────────────────────────

type PendingRequests = Arc<RwLock<HashMap<String, oneshot::Sender<TunnelResponse>>>>;
type TunnelSender = tokio::sync::mpsc::UnboundedSender<String>;

struct TunnelConnection {
    sender: TunnelSender,
    pending: PendingRequests,
}

pub struct RelayState {
    /// subdomain → active tunnel connection
    tunnels: RwLock<HashMap<String, Arc<TunnelConnection>>>,
    /// Base domain for tunnel URLs
    base_domain: String,
}

/// Derive a consistent subdomain from a token.
fn token_to_subdomain(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = hasher.finalize();
    // Use first 6 bytes → 12 hex chars
    hex::encode(&hash[..6])
}

// We use a simple hex encoding inline since we don't want to add another dep
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Start the relay server.
pub async fn start_relay(port: u16, base_domain: String) {
    let state = Arc::new(RelayState {
        tunnels: RwLock::new(HashMap::new()),
        base_domain,
    });

    let app = Router::new()
        .route("/_tunnel/register", any(handle_register))
        .fallback(any(handle_tunnel_request))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("Failed to bind relay");

    println!(
        "  {} relay listening on :{port}",
        colored::Colorize::green("mcpr")
    );

    axum::serve(listener, app).await.expect("Relay failed");
}

/// WebSocket registration endpoint.
async fn handle_register(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<RelayState>>,
) -> Response {
    let token = match params.get("token") {
        Some(t) => t.clone(),
        None => return (StatusCode::BAD_REQUEST, "missing token").into_response(),
    };
    let subdomain = params.get("subdomain").cloned();

    ws.on_upgrade(move |socket| handle_tunnel_ws(socket, token, subdomain, state))
}

async fn handle_tunnel_ws(
    socket: WebSocket,
    token: String,
    requested_subdomain: Option<String>,
    state: Arc<RelayState>,
) {
    let subdomain = requested_subdomain.unwrap_or_else(|| token_to_subdomain(&token));
    let url = format!("https://{}.{}", subdomain, state.base_domain);

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Send registration ack with assigned subdomain
    let ack = RegisterAck {
        subdomain: subdomain.clone(),
        url: url.clone(),
    };
    if ws_sink
        .send(Message::Text(serde_json::to_string(&ack).unwrap().into()))
        .await
        .is_err()
    {
        return;
    }

    // Create channel for sending requests to this tunnel client
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let pending: PendingRequests = Arc::new(RwLock::new(HashMap::new()));

    let conn = Arc::new(TunnelConnection {
        sender: tx,
        pending: pending.clone(),
    });

    // Register tunnel
    state.tunnels.write().await.insert(subdomain.clone(), conn);

    println!(
        "  {} tunnel registered: {}",
        colored::Colorize::green("↑"),
        colored::Colorize::cyan(url.as_str())
    );

    // Spawn task to forward outbound messages (relay → client) from channel to WS
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Read responses from WS (client → relay) and resolve pending requests
    while let Some(Ok(msg)) = ws_stream.next().await {
        if let Message::Text(text) = msg
            && let Ok(resp) = serde_json::from_str::<TunnelResponse>(&text)
        {
            let mut p = pending.write().await;
            if let Some(sender) = p.remove(&resp.id) {
                let _ = sender.send(resp);
            }
        }
    }

    // Client disconnected — clean up
    send_task.abort();
    state.tunnels.write().await.remove(&subdomain);
    println!(
        "  {} tunnel disconnected: {}",
        colored::Colorize::red("↓"),
        subdomain
    );
}

/// Catch-all handler: extract subdomain from Host header, forward request through tunnel.
async fn handle_tunnel_request(
    State(state): State<Arc<RelayState>>,
    method: Method,
    headers: HeaderMap,
    uri: axum::http::Uri,
    body: Bytes,
) -> Response {
    // Extract subdomain from Host header: "abc123.tunnel.mcpr.app" → "abc123"
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let subdomain = host.split('.').next().unwrap_or("").to_string();
    let path_str = uri
        .path_and_query()
        .map(|p| p.to_string())
        .unwrap_or_else(|| "/".into());

    if subdomain.is_empty() {
        relay_log(
            "-",
            method.as_str(),
            &path_str,
            400,
            0,
            std::time::Duration::ZERO,
        );
        return (StatusCode::BAD_REQUEST, "missing host header").into_response();
    }

    // Find tunnel connection
    let tunnels = state.tunnels.read().await;
    let conn = match tunnels.get(&subdomain) {
        Some(c) => c.clone(),
        None => {
            relay_log(
                &subdomain,
                method.as_str(),
                &path_str,
                502,
                0,
                std::time::Duration::ZERO,
            );
            return (StatusCode::BAD_GATEWAY, "tunnel not found").into_response();
        }
    };
    drop(tunnels);

    // Build tunnel request
    let req_id = uuid::Uuid::new_v4().to_string();
    let mut req_headers = HashMap::new();
    for (key, val) in headers.iter() {
        if let Ok(v) = val.to_str() {
            req_headers.insert(key.to_string(), v.to_string());
        }
    }

    let body_b64 = if body.is_empty() {
        None
    } else {
        Some(base64::engine::general_purpose::STANDARD.encode(&body))
    };

    let tunnel_req = TunnelRequest {
        id: req_id.clone(),
        method: method.to_string(),
        path: uri
            .path_and_query()
            .map(|p| p.to_string())
            .unwrap_or_else(|| "/".into()),
        headers: req_headers,
        body: body_b64,
    };

    // Register pending response
    let (resp_tx, resp_rx) = oneshot::channel();
    conn.pending.write().await.insert(req_id.clone(), resp_tx);

    // Send request to tunnel client
    let msg = serde_json::to_string(&tunnel_req).unwrap();
    if conn.sender.send(msg).is_err() {
        conn.pending.write().await.remove(&req_id);
        relay_log(
            &subdomain,
            method.as_str(),
            &path_str,
            502,
            0,
            std::time::Duration::ZERO,
        );
        return (StatusCode::BAD_GATEWAY, "tunnel disconnected").into_response();
    }

    // Wait for response with timeout
    let path = uri
        .path_and_query()
        .map(|p| p.to_string())
        .unwrap_or_else(|| "/".into());
    let start = std::time::Instant::now();

    match tokio::time::timeout(std::time::Duration::from_secs(30), resp_rx).await {
        Ok(Ok(resp)) => {
            let status_code = StatusCode::from_u16(resp.status).unwrap_or(StatusCode::BAD_GATEWAY);
            let body_len = resp.body.as_ref().map(|b| b.len()).unwrap_or(0);
            relay_log(
                &subdomain,
                method.as_ref(),
                &path,
                resp.status,
                body_len,
                start.elapsed(),
            );

            let mut builder = Response::builder().status(status_code);

            for (k, v) in &resp.headers {
                if let (Ok(name), Ok(val)) = (
                    HeaderName::from_bytes(k.as_bytes()),
                    HeaderValue::from_str(v),
                ) {
                    builder = builder.header(name, val);
                }
            }

            let body_bytes = resp
                .body
                .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
                .unwrap_or_default();

            builder
                .body(axum::body::Body::from(body_bytes))
                .unwrap_or_else(|_| {
                    (StatusCode::INTERNAL_SERVER_ERROR, "response build error").into_response()
                })
        }
        Ok(Err(_)) => {
            relay_log(&subdomain, method.as_ref(), &path, 502, 0, start.elapsed());
            (StatusCode::BAD_GATEWAY, "tunnel dropped request").into_response()
        }
        Err(_) => {
            conn.pending.write().await.remove(&req_id);
            relay_log(&subdomain, method.as_ref(), &path, 504, 0, start.elapsed());
            (StatusCode::GATEWAY_TIMEOUT, "tunnel timeout").into_response()
        }
    }
}

/// nginx-style access log for relay mode.
/// Format: `2026-03-22 14:02:31  subdomain  POST /mcp  → 200  1234b  12ms`
fn relay_log(
    subdomain: &str,
    method: &str,
    path: &str,
    status: u16,
    body_len: usize,
    duration: std::time::Duration,
) {
    use colored::Colorize;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let status_str = if status < 300 {
        format!("{status}").green().to_string()
    } else if status < 400 {
        format!("{status}").yellow().to_string()
    } else {
        format!("{status}").red().to_string()
    };
    let ms = duration.as_millis();
    println!(
        "  {now}  {sub}  {method} {path}  → {status}  {body_len}b  {ms}ms",
        sub = subdomain.dimmed(),
        status = status_str,
    );
}

// ── Tunnel client (embedded in mcpr) ─────────────────────────────────

/// Connect to a relay server and return the assigned public URL.
/// Spawns a background task that proxies requests from relay → localhost.
/// If `subdomain` is provided, requests that specific subdomain from the relay.
pub async fn start_tunnel_client(
    port: u16,
    relay_url: &str,
    token: &str,
    subdomain: Option<&str>,
    tui_state: crate::tui::SharedTuiState,
) -> Result<String, String> {
    let relay = relay_url.trim_end_matches('/');
    let sub_param = subdomain
        .map(|s| format!("&subdomain={s}"))
        .unwrap_or_default();
    let ws_url = if relay.starts_with("ws://") || relay.starts_with("wss://") {
        format!("{relay}/_tunnel/register?token={token}{sub_param}")
    } else if let Some(rest) = relay.strip_prefix("https://") {
        format!("wss://{rest}/_tunnel/register?token={token}{sub_param}")
    } else if let Some(rest) = relay.strip_prefix("http://") {
        format!("ws://{rest}/_tunnel/register?token={token}{sub_param}")
    } else {
        format!("wss://{relay}/_tunnel/register?token={token}{sub_param}")
    };

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("Failed to connect to relay: {e}"))?;

    let (mut ws_sink, mut ws_stream) = ws_stream.split();

    // Read registration ack
    let ack: RegisterAck = loop {
        match ws_stream.next().await {
            Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                match serde_json::from_str(&text) {
                    Ok(ack) => break ack,
                    Err(_) => continue,
                }
            }
            Some(Err(e)) => return Err(format!("WebSocket error: {e}")),
            None => return Err("Relay closed connection before ack".into()),
            _ => continue,
        }
    };

    let public_url = ack.url.clone();
    let local_base = format!("http://localhost:{port}");
    let http_client = reqwest::Client::new();

    // Mark tunnel as connected
    tui_state.lock().unwrap().tunnel_status = crate::tui::ConnectionStatus::Connected;

    // Spawn background task: read requests from relay, forward to localhost, respond
    tokio::spawn(async move {
        // We need to send responses back, so use a channel
        let (resp_tx, mut resp_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        // Spawn sender task
        let send_task = tokio::spawn(async move {
            while let Some(msg) = resp_rx.recv().await {
                if ws_sink
                    .send(tokio_tungstenite::tungstenite::Message::Text(msg.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        while let Some(Ok(msg)) = ws_stream.next().await {
            if let tokio_tungstenite::tungstenite::Message::Text(text) = msg
                && let Ok(req) = serde_json::from_str::<TunnelRequest>(&text)
            {
                let client = http_client.clone();
                let base = local_base.clone();
                let tx = resp_tx.clone();

                tokio::spawn(async move {
                    let resp = forward_to_local(&client, &base, req).await;
                    let msg = serde_json::to_string(&resp).unwrap();
                    let _ = tx.send(msg);
                });
            }
        }

        // Tunnel disconnected
        tui_state.lock().unwrap().tunnel_status = crate::tui::ConnectionStatus::Disconnected;

        send_task.abort();
    });

    Ok(public_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Subdomain derivation ──

    #[test]
    fn token_to_subdomain_deterministic() {
        let a = token_to_subdomain("my-token");
        let b = token_to_subdomain("my-token");
        assert_eq!(a, b, "same token must produce same subdomain");
    }

    #[test]
    fn token_to_subdomain_different_tokens_differ() {
        let a = token_to_subdomain("token-a");
        let b = token_to_subdomain("token-b");
        assert_ne!(a, b);
    }

    #[test]
    fn token_to_subdomain_is_12_hex_chars() {
        let sub = token_to_subdomain("test");
        assert_eq!(sub.len(), 12);
        assert!(sub.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // ── Hex encoding ──

    #[test]
    fn hex_encode_empty() {
        assert_eq!(hex::encode(&[]), "");
    }

    #[test]
    fn hex_encode_known_values() {
        assert_eq!(hex::encode(&[0x00]), "00");
        assert_eq!(hex::encode(&[0xff]), "ff");
        assert_eq!(hex::encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }

    // ── Tunnel protocol serialization ──

    #[test]
    fn tunnel_request_roundtrip() {
        let req = TunnelRequest {
            id: "req-1".into(),
            method: "POST".into(),
            path: "/mcp".into(),
            headers: HashMap::from([("content-type".into(), "application/json".into())]),
            body: Some(base64::engine::general_purpose::STANDARD.encode(b"{\"test\":true}")),
        };
        let json = serde_json::to_string(&req).unwrap();
        let decoded: TunnelRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.id, "req-1");
        assert_eq!(decoded.method, "POST");
        assert_eq!(decoded.path, "/mcp");
        let body = base64::engine::general_purpose::STANDARD
            .decode(decoded.body.unwrap())
            .unwrap();
        assert_eq!(body, b"{\"test\":true}");
    }

    #[test]
    fn tunnel_response_roundtrip() {
        let resp = TunnelResponse {
            id: "req-1".into(),
            status: 200,
            headers: HashMap::from([("content-type".into(), "application/json".into())]),
            body: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        let decoded: TunnelResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.id, "req-1");
        assert_eq!(decoded.status, 200);
        assert!(decoded.body.is_none());
    }

    #[test]
    fn register_ack_roundtrip() {
        let ack = RegisterAck {
            subdomain: "abc123".into(),
            url: "https://abc123.tunnel.example.com".into(),
        };
        let json = serde_json::to_string(&ack).unwrap();
        let decoded: RegisterAck = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.subdomain, "abc123");
        assert_eq!(decoded.url, "https://abc123.tunnel.example.com");
    }

    #[test]
    fn tunnel_request_no_body() {
        let req = TunnelRequest {
            id: "req-2".into(),
            method: "GET".into(),
            path: "/mcp".into(),
            headers: HashMap::new(),
            body: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let decoded: TunnelRequest = serde_json::from_str(&json).unwrap();
        assert!(decoded.body.is_none());
    }
}

/// Forward a tunnel request to the local server and return a tunnel response.
async fn forward_to_local(
    client: &reqwest::Client,
    base_url: &str,
    req: TunnelRequest,
) -> TunnelResponse {
    let url = format!("{base_url}{}", req.path);
    let method: Method = req.method.parse().unwrap_or(Method::GET);

    let mut builder = client.request(method, &url);

    for (k, v) in &req.headers {
        // Skip host header — we're forwarding to localhost
        if k.to_lowercase() == "host" {
            continue;
        }
        builder = builder.header(k.as_str(), v.as_str());
    }

    if let Some(body_b64) = &req.body
        && let Ok(body) = base64::engine::general_purpose::STANDARD.decode(body_b64)
    {
        builder = builder.body(body);
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let mut headers = HashMap::new();
            for (k, v) in resp.headers() {
                if let Ok(val) = v.to_str() {
                    headers.insert(k.to_string(), val.to_string());
                }
            }
            let body = resp.bytes().await.unwrap_or_default();
            let body_b64 = if body.is_empty() {
                None
            } else {
                Some(base64::engine::general_purpose::STANDARD.encode(&body))
            };
            TunnelResponse {
                id: req.id,
                status,
                headers,
                body: body_b64,
            }
        }
        Err(_) => TunnelResponse {
            id: req.id,
            status: 502,
            headers: HashMap::new(),
            body: Some(base64::engine::general_purpose::STANDARD.encode(b"upstream error")),
        },
    }
}
