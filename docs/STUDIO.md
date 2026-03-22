# mcpr studio

Widget development environment for testing MCP widgets without connecting to ChatGPT or Claude.

## Why

Every time you change a widget, you'd normally need to: rebuild → deploy → open ChatGPT/Claude → trigger the tool → wait for the response. Studio skips all of that — edit mock data, hit Apply, see the result instantly.

## Features

**Widget preview** — Browse and render all widgets discovered from your MCP backend.

**Platform simulation** — Test widgets as they'd appear in OpenAI or Claude, with full API mocking:
- OpenAI: `window.openai` with `callTool`, `sendFollowUpMessage`, `setWidgetState`, etc.
- Claude: JSON-RPC 2.0 postMessage protocol (`ui/initialize`, `ui/message`, `ui/call-server-tool`)

**Mock data editor** — Edit `toolInput`, `toolOutput`, `_meta`, and `widgetState` as JSON. Click Apply to inject new data into the widget without reloading.

**Action log** — Every method call the widget makes (`callTool`, `sendMessage`, `openLink`, etc.) is logged with timestamp and arguments.

**Display controls** — Switch theme (light/dark), display mode (compact/inline/fullscreen), and locale.

## Quick Start

```bash
cd studio
npm install
npm run dev
```

Studio connects to your local mcpr at `http://localhost:3000` by default.

To connect to a remote mcpr instance:
```
http://localhost:5173?proxy=https://your-mcpr-instance.com
```

## Testing Workflow

1. Start your MCP backend and mcpr
2. Open Studio — your widgets appear automatically
3. Click a widget to open the debug view
4. Edit mock data (paste real tool output or craft test cases)
5. Switch between OpenAI / Claude to verify both platforms
6. Check the action log to verify widget behavior
7. Iterate without leaving the browser

## Build

```bash
npm run build
```

Output goes to `../static/studio/` — mcpr serves it automatically at `/studio/`.
