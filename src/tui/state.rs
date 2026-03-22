use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

const MAX_LOG_ENTRIES: usize = 10_000;

#[derive(Clone, Copy, PartialEq)]
pub enum ConnectionStatus {
    Unknown,
    Disconnected,
    Connecting,
    Connected,
}

impl ConnectionStatus {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Unknown => "Unknown",
            Self::Disconnected => "Disconnected",
            Self::Connecting => "Connecting…",
            Self::Connected => "Connected",
        }
    }
}

pub struct LogEntry {
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub mcp_method: Option<String>,
    pub status: u16,
    pub note: String,
    pub upstream_url: Option<String>,
    pub resp_size: Option<usize>,
}

impl LogEntry {
    pub fn new(method: &str, path: &str, status: u16, note: &str) -> Self {
        Self {
            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            method: method.to_string(),
            path: path.to_string(),
            mcp_method: None,
            status,
            note: note.to_string(),
            upstream_url: None,
            resp_size: None,
        }
    }

    pub fn mcp_method(mut self, m: &str) -> Self {
        self.mcp_method = Some(m.to_string());
        self
    }

    pub fn upstream(mut self, url: &str) -> Self {
        self.upstream_url = Some(url.to_string());
        self
    }

    pub fn size(mut self, bytes: usize) -> Self {
        self.resp_size = Some(bytes);
        self
    }
}

pub struct TuiState {
    // Info panel
    pub proxy_url: String,
    pub tunnel_url: String,
    pub mcp_upstream: String,
    pub widgets: String,
    pub tunnel_status: ConnectionStatus,
    pub mcp_status: ConnectionStatus,
    pub widgets_status: ConnectionStatus,
    pub widget_count: Option<usize>,
    pub widget_names: Vec<String>,
    pub started_at: Instant,
    pub request_count: u64,

    // Log panel
    pub log_entries: VecDeque<LogEntry>,
    pub auto_scroll: bool,
    pub scroll_offset: u16,
}

impl TuiState {
    pub fn new() -> Self {
        Self {
            proxy_url: String::new(),
            tunnel_url: String::new(),
            mcp_upstream: String::new(),
            widgets: "(none)".into(),
            tunnel_status: ConnectionStatus::Disconnected,
            mcp_status: ConnectionStatus::Unknown,
            widgets_status: ConnectionStatus::Unknown,
            widget_count: None,
            widget_names: Vec::new(),
            started_at: Instant::now(),
            request_count: 0,
            log_entries: VecDeque::new(),
            auto_scroll: true,
            scroll_offset: 0,
        }
    }

    pub fn push_log(&mut self, entry: LogEntry) {
        self.request_count += 1;
        self.log_entries.push_back(entry);
        if self.log_entries.len() > MAX_LOG_ENTRIES {
            self.log_entries.pop_front();
        }
    }

    pub fn uptime(&self) -> String {
        let secs = self.started_at.elapsed().as_secs();
        if secs < 60 {
            format!("{secs}s")
        } else if secs < 3600 {
            format!("{}m {}s", secs / 60, secs % 60)
        } else {
            format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
        }
    }
}

pub type SharedTuiState = Arc<Mutex<TuiState>>;

pub fn new_shared_state() -> SharedTuiState {
    Arc::new(Mutex::new(TuiState::new()))
}
