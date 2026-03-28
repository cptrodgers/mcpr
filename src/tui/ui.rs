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

            let method_style = Style::default().add_modifier(Modifier::BOLD);

            let mut spans = vec![
                Span::styled(
                    format!("  {} ", entry.timestamp),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(format!("{:<4} ", entry.method), method_style),
                Span::raw(format!("{} ", entry.path)),
            ];

            if let Some(ref mcp) = entry.mcp_method {
                spans.push(Span::styled(
                    format!("{mcp} "),
                    Style::default().fg(Color::Yellow),
                ));
            }

            spans.push(Span::styled("→ ", Style::default().fg(Color::DarkGray)));
            spans.push(Span::styled(
                format!("{}", entry.status),
                Style::default().fg(status_color),
            ));

            if let Some(size) = entry.resp_size {
                spans.push(Span::styled(
                    format!(" {}", format_bytes(size)),
                    Style::default().fg(Color::DarkGray),
                ));
            }

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
