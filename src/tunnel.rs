//! Tunnel client — connects to a relay server and proxies requests to localhost.

use std::collections::HashMap;

use base64::Engine;
use futures_util::{SinkExt, StreamExt};

use crate::relay::{RegisterAck, RegisterRequest, TunnelRequest, TunnelResponse};

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
    let ws_url = if relay.starts_with("ws://") || relay.starts_with("wss://") {
        format!("{relay}/_tunnel/register")
    } else if let Some(rest) = relay.strip_prefix("https://") {
        format!("wss://{rest}/_tunnel/register")
    } else if let Some(rest) = relay.strip_prefix("http://") {
        format!("ws://{rest}/_tunnel/register")
    } else {
        format!("wss://{relay}/_tunnel/register")
    };

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("Failed to connect to relay: {e}"))?;

    let (mut ws_sink, mut ws_stream) = ws_stream.split();

    // Send token as first message (not in URL to avoid log exposure)
    let reg = RegisterRequest {
        token: token.to_string(),
        subdomain: subdomain.map(|s| s.to_string()),
    };
    ws_sink
        .send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::to_string(&reg).unwrap().into(),
        ))
        .await
        .map_err(|e| format!("Failed to send registration: {e}"))?;

    // Read registration ack (or close frame on auth failure)
    let ack: RegisterAck = loop {
        match ws_stream.next().await {
            Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                match serde_json::from_str(&text) {
                    Ok(ack) => break ack,
                    Err(_) => continue,
                }
            }
            Some(Ok(tokio_tungstenite::tungstenite::Message::Close(Some(frame)))) => {
                return Err(format!("Authentication failed: {}", frame.reason));
            }
            Some(Ok(tokio_tungstenite::tungstenite::Message::Close(None))) => {
                return Err("Authentication failed: relay closed connection".into());
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

/// Forward a tunnel request to the local server and return a tunnel response.
async fn forward_to_local(
    client: &reqwest::Client,
    base_url: &str,
    req: TunnelRequest,
) -> TunnelResponse {
    let url = format!("{base_url}{}", req.path);
    let method: axum::http::Method = req.method.parse().unwrap_or(axum::http::Method::GET);

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
