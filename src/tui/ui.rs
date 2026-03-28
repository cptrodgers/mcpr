use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

use super::state::{ConnectionStatus, SharedTuiState};

pub fn render(frame: &mut Frame, state: &SharedTuiState) {
    let s = state.lock().unwrap();

    // Size left panel to fit the longest URL + label padding (10) + border (2) + margin (2)
    let longest_url = [&s.proxy_url, &s.tunnel_url, &s.mcp_upstream, &s.widgets]
        .iter()
        .map(|u| u.len())
        .max()
        .unwrap_or(20);
    let ideal_width = (longest_url + 14) as u16;
    // Clamp: at least 36, at most 50% of terminal width
    let max_left = frame.area().width / 2;
    let left_width = ideal_width.clamp(36, max_left);

    let chunks = Layout::horizontal([Constraint::Length(left_width), Constraint::Min(40)])
        .split(frame.area());

    render_info_panel(frame, chunks[0], &s);
    render_log_panel(frame, chunks[1], &s);
}

fn status_style(status: ConnectionStatus) -> (Color, &'static str) {
    match status {
        ConnectionStatus::Connected => (Color::Green, "●"),
        ConnectionStatus::Connecting => (Color::Yellow, "◐"),
        ConnectionStatus::Disconnected => (Color::Red, "○"),
        ConnectionStatus::Unknown => (Color::DarkGray, "?"),
    }
}

fn status_line(label: &str, status: ConnectionStatus) -> Line<'static> {
    let (color, symbol) = status_style(status);
    Line::from(vec![
        Span::styled(
            format!("  {label:<10}"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(symbol.to_string(), Style::default().fg(color)),
        Span::raw(" "),
        Span::styled(status.label().to_string(), Style::default().fg(color)),
    ])
}

fn render_info_panel(frame: &mut Frame, area: Rect, s: &super::state::TuiState) {
    let block = Block::default()
        .title(" mcpr proxy ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray));

    // Truncate long URLs to fit panel
    let max_url_len = area.width.saturating_sub(12) as usize;
    let truncate = |url: &str| -> String {
        if url.len() > max_url_len {
            format!("{}…", &url[..max_url_len.saturating_sub(1)])
        } else {
            url.to_string()
        }
    };

    let widgets_display = if let Some(count) = s.widget_count {
        format!("{} ({count} widgets)", truncate(&s.widgets))
    } else {
        truncate(&s.widgets)
    };

    // ASCII logo
    let logo_color = Color::Rgb(210, 130, 50); // orange to match the logo
    let logo_lines = [r"  ┌─┬─┐ ", r"  │╲│╱│ ", r"  │╱ ╲│ ", r"  └─┴─┘ "];
    let mut lines: Vec<Line> = logo_lines
        .iter()
        .map(|l| {
            Line::from(Span::styled(
                *l,
                Style::default().fg(logo_color).add_modifier(Modifier::BOLD),
            ))
        })
        .collect();

    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("  Proxy   ", Style::default().fg(Color::DarkGray)),
        Span::raw(truncate(&s.proxy_url)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  Tunnel  ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            truncate(&s.tunnel_url),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  MCP     ", Style::default().fg(Color::DarkGray)),
        Span::raw(truncate(&s.mcp_upstream)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  Widgets ", Style::default().fg(Color::DarkGray)),
        Span::raw(widgets_display),
    ]));
    lines.push(Line::from(""));

    lines.push(status_line("Tunnel", s.tunnel_status));
    lines.push(status_line("MCP", s.mcp_status));
    lines.push(status_line("Widgets", s.widgets_status));

    lines.extend([
        Line::from(""),
        Line::from(vec![
            Span::styled("  Uptime  ", Style::default().fg(Color::DarkGray)),
            Span::raw(s.uptime()),
        ]),
        Line::from(vec![
            Span::styled("  Reqs    ", Style::default().fg(Color::DarkGray)),
            Span::raw(s.request_count.to_string()),
        ]),
    ]);

    if !s.widget_names.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  Widgets found:",
            Style::default().fg(Color::DarkGray),
        )));
        for name in &s.widget_names {
            lines.push(Line::from(vec![
                Span::styled("    • ", Style::default().fg(Color::DarkGray)),
                Span::raw(name.clone()),
            ]));
        }
    }

    lines.push(Line::from(""));
    let studio_url = format!("{}/studio", s.proxy_url);
    lines.push(Line::from(vec![
        Span::styled("  Studio  ", Style::default().fg(Color::DarkGray)),
        Span::styled(studio_url, Style::default().fg(Color::Cyan)),
    ]));

    lines.extend([
        Line::from(""),
        Line::from(Span::styled(
            "  q quit  ↑↓ scroll",
            Style::default().fg(Color::DarkGray),
        )),
    ]);

    let paragraph = Paragraph::new(lines).block(block);
    frame.render_widget(paragraph, area);
}

fn render_log_panel(frame: &mut Frame, area: Rect, s: &super::state::TuiState) {
    let block = Block::default()
        .title(" Requests ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray));

    let inner = block.inner(area);
    let visible_height = inner.height as usize;

    // Build log lines
    //
    // MCP requests:    HH:MM:SS POST  tools/call      200  1.2KB  45ms  rewritten
    // Other requests:  HH:MM:SS GET   /oauth/register  201  232B   8ms  rewritten
    let log_lines: Vec<Line> = s
        .log_entries
        .iter()
        .map(|entry| {
            let status_color = if entry.status < 300 {
                Color::Green
            } else if entry.status < 400 {
                Color::Yellow
            } else {
                Color::Red
            };

            let method_color = match entry.method.as_str() {
                "POST" => Color::Cyan,
                "GET" => Color::Green,
                "DELETE" => Color::Red,
                _ => Color::White,
            };

            // Layout: time  METHOD  status  size  upstream↑  proxy↓  label
            // Fixed-width columns first, variable-length label last (never truncated)

            let mut spans = vec![
                Span::styled(
                    format!(" {} ", entry.timestamp),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(
                    format!("{:<5}", entry.method),
                    Style::default()
                        .fg(method_color)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{:<4}", entry.status),
                    Style::default().fg(status_color),
                ),
            ];

            // Size
            let size_str = match entry.resp_size {
                Some(size) => format!("{:>7}", format_bytes(size)),
                None => "      -".to_string(),
            };
            spans.push(Span::styled(
                format!("{size_str} "),
                Style::default().fg(Color::DarkGray),
            ));

            // Duration: total | upstream↑ proxy↓
            match (entry.duration_ms, entry.upstream_ms) {
                (Some(total), Some(upstream)) => {
                    let proxy = total.saturating_sub(upstream);
                    spans.push(Span::styled(
                        format!("{:>5} ", format_duration(total)),
                        Style::default()
                            .fg(duration_color(total))
                            .add_modifier(Modifier::BOLD),
                    ));
                    spans.push(Span::styled(
                        format!("{:>5}↑", format_duration(upstream)),
                        Style::default().fg(duration_color(upstream)),
                    ));
                    spans.push(Span::styled(
                        format!("{:>5}↓ ", format_duration(proxy)),
                        Style::default().fg(Color::Cyan),
                    ));
                }
                (Some(total), None) => {
                    spans.push(Span::styled(
                        format!("{:>5} ", format_duration(total)),
                        Style::default()
                            .fg(duration_color(total))
                            .add_modifier(Modifier::BOLD),
                    ));
                    spans.push(Span::raw("            "));
                }
                _ => {
                    spans.push(Span::styled(
                        "    -              ",
                        Style::default().fg(Color::DarkGray),
                    ));
                }
            }

            // Label — MCP method (yellow) or path, full length at the end
            if let Some(ref mcp) = entry.mcp_method {
                spans.push(Span::styled(
                    mcp.clone(),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ));
            } else {
                spans.push(Span::raw(entry.path.clone()));
            }

            // Upstream URL
            if let Some(ref url) = entry.upstream_url {
                spans.push(Span::styled(
                    format!(" → {url}"),
                    Style::default().fg(Color::DarkGray),
                ));
            }

            // Note (rewritten, passthrough, sse, etc.)
            if !entry.note.is_empty() {
                spans.push(Span::styled(
                    format!(" {}", entry.note),
                    Style::default().fg(Color::DarkGray),
                ));
            }

            Line::from(spans)
        })
        .collect();

    let total = log_lines.len();

    // Calculate scroll position
    let scroll = if s.auto_scroll {
        total.saturating_sub(visible_height) as u16
    } else {
        s.scroll_offset
    };

    let paragraph = Paragraph::new(log_lines).block(block).scroll((scroll, 0));
    frame.render_widget(paragraph, area);

    // Scrollbar
    if total > visible_height {
        let mut scrollbar_state =
            ScrollbarState::new(total.saturating_sub(visible_height)).position(scroll as usize);
        frame.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(None)
                .end_symbol(None),
            area.inner(ratatui::layout::Margin {
                vertical: 1,
                horizontal: 0,
            }),
            &mut scrollbar_state,
        );
    }
}

fn format_bytes(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes}B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn format_duration(ms: u64) -> String {
    if ms < 1000 {
        format!("{ms}ms")
    } else {
        format!("{:.1}s", ms as f64 / 1000.0)
    }
}

fn duration_color(ms: u64) -> Color {
    if ms < 100 {
        Color::Green
    } else if ms < 500 {
        Color::Yellow
    } else {
        Color::Red
    }
}
