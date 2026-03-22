use crate::tui::state::{LogEntry, SharedTuiState};

/// Populate the TUI state with startup info.
pub fn log_startup(
    state: &SharedTuiState,
    port: u16,
    public_url: &str,
    mcp_upstream: &str,
    widgets: Option<&str>,
) {
    let mut s = state.lock().unwrap();
    s.proxy_url = format!("http://localhost:{port}");
    s.tunnel_url = public_url.to_string();
    s.mcp_upstream = mcp_upstream.to_string();
    s.widgets = widgets.unwrap_or("(none)").to_string();
}

/// Push a request log entry to the TUI state.
pub fn log_request(state: &SharedTuiState, entry: LogEntry) {
    state.lock().unwrap().push_log(entry);
}
