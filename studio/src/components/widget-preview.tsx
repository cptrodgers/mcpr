import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { VIEWPORT_PRESETS } from "@/lib/store";
import { callTool } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";

/** SVG icons for chat chrome */
const icons = {
  hamburger: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  chevronDown: (color: string) => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  compose: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  plus: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  mic: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  ),
  send: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
    </svg>
  ),
  dots: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={color}>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  ),
  share: (color: string) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
  mcpIcon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
    </svg>
  ),
};

/** Chat chrome that wraps the widget iframe to simulate real ChatGPT / Claude UI. */
function ChatChrome({
  platform,
  theme,
  toolName,
  children,
}: {
  platform: string;
  theme: string;
  toolName: string;
  children: React.ReactNode;
}) {
  const dark = theme === "dark";
  const font =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  if (platform === "claude") {
    const bg = dark ? "#2b2a27" : "#eeece2";
    const msgBg = dark ? "#3c3b37" : "#ffffff";
    const textColor = dark ? "#e8e4db" : "#1a1915";
    const subColor = dark ? "#a39e93" : "#6b6560";
    const border = dark ? "#4a4843" : "#d8d4ca";
    return (
      <div
        style={{
          background: bg,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          fontFamily: font,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: `1px solid ${border}`,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {icons.hamburger(subColor)}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <span
              style={{ fontSize: "15px", fontWeight: 600, color: textColor }}
            >
              Claude
            </span>
            {icons.chevronDown(subColor)}
          </div>
          {icons.compose(subColor)}
        </div>
        {/* Chat */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {/* Content column */}
          <div
            style={{
              maxWidth: "768px",
              margin: "0 auto",
              padding: "20px 16px",
            }}
          >
            {/* Assistant message */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: dark ? "#d4a574" : "#c67b3c",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "13px",
                  color: "#fff",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                C
              </div>
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: "1.6",
                  color: textColor,
                  background: msgBg,
                  borderRadius: "18px",
                  padding: "10px 16px",
                }}
              >
                Here are your results:
              </div>
            </div>
            {/* Widget */}
            {children}
          </div>
        </div>
        {/* Input */}
        <div style={{ padding: "8px 12px 12px" }}>
          <div
            style={{
              maxWidth: "768px",
              margin: "0 auto",
              background: msgBg,
              borderRadius: "24px",
              border: `1px solid ${border}`,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {icons.plus(subColor)}
            <span style={{ flex: 1, fontSize: "14px", color: subColor }}>
              Reply to Claude...
            </span>
            {icons.mic(subColor)}
          </div>
        </div>
      </div>
    );
  }

  // OpenAI / ChatGPT — matching real UI from screenshots
  const bg = dark ? "#212121" : "#ffffff";
  const textColor = dark ? "#ececec" : "#0d0d0d";
  const subColor = dark ? "#8e8e8e" : "#8e8e8e";
  const inputBg = dark ? "#303030" : "#f4f4f4";
  const borderColor = dark ? "#3a3a3a" : "#e5e5e5";
  return (
    <div
      style={{
        background: bg,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: font,
      }}
    >
      {/* Header — matches real ChatGPT: hamburger | "ChatGPT v" | compose ... */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${borderColor}`,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {icons.hamburger(subColor)}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
          }}
        >
          <span style={{ fontSize: "15px", fontWeight: 600, color: textColor }}>
            ChatGPT
          </span>
          {icons.chevronDown(subColor)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {icons.share(subColor)}
          {icons.dots(subColor)}
        </div>
      </div>
      {/* Chat area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Content column — centered with max-width like real ChatGPT */}
        <div
          style={{ maxWidth: "768px", margin: "0 auto", padding: "20px 16px" }}
        >
          {/* Tool label — like real ChatGPT shows MCP tool name */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "12px",
              fontSize: "13px",
              color: subColor,
            }}
          >
            {icons.mcpIcon}
            <span style={{ fontWeight: 500, color: dark ? "#b4b4b4" : "#555" }}>
              {toolName}
            </span>
          </div>
          {/* Widget — full width within the content column */}
          {children}
        </div>
      </div>
      {/* Input bar — matches real: rounded pill with +, MCP label, mic, send */}
      <div style={{ padding: "8px 12px 12px" }}>
        <div
          style={{
            maxWidth: "768px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "0",
          }}
        >
          <div
            style={{
              background: inputBg,
              borderRadius: "24px",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: `1px solid ${borderColor}`,
            }}
          >
            {icons.plus(subColor)}
            <span style={{ flex: 1, fontSize: "14px", color: subColor }}>
              Ask anything
            </span>
            {icons.mic(subColor)}
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: dark ? "#676767" : "#0d0d0d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {icons.send}
            </div>
          </div>
          <div
            style={{
              textAlign: "center",
              fontSize: "11px",
              color: subColor,
              marginTop: "6px",
            }}
          >
            ChatGPT can make mistakes. Check important info.
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewportFrame({
  hidden,
  refCallback,
}: {
  hidden: boolean;
  refCallback: (el: HTMLIFrameElement | null) => void;
}) {
  const {
    viewportPreset,
    viewportCustom,
    platform,
    theme,
    selected,
    resolveWidgetName: resolve,
  } = useStore();
  const toolName =
    selected?.type === "tool"
      ? selected.tool.name
      : selected?.type === "widget"
        ? selected.name
        : resolve() || "Widget";
  const viewport =
    viewportPreset === "custom"
      ? viewportCustom
      : VIEWPORT_PRESETS[viewportPreset];

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Compute scale to fit viewport within available container space
  useEffect(() => {
    const container = containerRef.current;
    if (!container || hidden) return;

    const update = () => {
      const availW = container.clientWidth - 32;
      const availH = container.clientHeight - 56;
      if (availW <= 0 || availH <= 0) return;
      const s = Math.min(1, availW / viewport.width, availH / viewport.height);
      setScale(s);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [viewport.width, viewport.height, hidden]);

  const scaledW = viewport.width * scale;
  const scaledH = viewport.height * scale;

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden flex flex-col items-center justify-start p-4 ${
        hidden ? "hidden" : ""
      }`}
    >
      <div
        className="rounded-2xl border border-border overflow-hidden shrink-0"
        style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
      >
        {/* Scaled viewport container */}
        <div
          style={{
            width: `${viewport.width}px`,
            height: `${viewport.height}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ChatChrome platform={platform} theme={theme} toolName={toolName}>
            <iframe
              ref={refCallback}
              className="border-none block"
              style={{ width: "100%", minHeight: "100px" }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          </ChatChrome>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground mt-2">
        {viewport.width} x {viewport.height}
        {scale < 1 && ` (${Math.round(scale * 100)}%)`}
      </span>
    </div>
  );
}

type Tab = "widget" | "json";

export function WidgetPreview() {
  const {
    jsonOutput,
    lastResult,
    resolveWidgetName,
    setIframeRef,
    logAction,
    addPendingMessage,
  } = useStore();
  const widgetName = resolveWidgetName();
  const [activeTab, setActiveTab] = useState<Tab>("widget");

  // Auto-switch to widget tab when widget renders, json tab when no widget
  useEffect(() => {
    if (widgetName && lastResult) setActiveTab("widget");
    else if (!widgetName && jsonOutput) setActiveTab("json");
  }, [widgetName, lastResult, jsonOutput]);

  const refCallback = useCallback(
    (el: HTMLIFrameElement | null) => {
      setIframeRef(el);
    },
    [setIframeRef]
  );

  // Listen for iframe messages
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data) return;
      if (data.type === "mcpr_resize" && data.height) {
        const iframe = useStore.getState()._iframeRef;
        if (iframe) iframe.style.height = `${data.height}px`;
        return;
      }
      // Sandbox violation reports from the runtime trap script
      if (data.type === "mcpr_sandbox_violation") {
        const state = useStore.getState();
        const categoryLabels: Record<string, string> = {
          storage: "sandbox (storage)",
          permission: "sandbox (permission)",
          device: "sandbox (device API)",
          worker: "sandbox (worker)",
          navigation: "sandbox (navigation)",
        };
        const widgetName = state.resolveWidgetName();
        state.addCspViolation({
          id: `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          time: new Date().toTimeString().split(" ")[0],
          directive: categoryLabels[data.category] || "sandbox",
          blockedUri: data.api || "",
          sourceFile: widgetName ? `/widgets/${widgetName}.html` : "",
          lineNumber: 0,
          columnNumber: 0,
          source: "runtime",
          severity: data.severity === "warning" ? "warning" : "error",
          fix:
            data.message ||
            `${data.api} is not available in widget sandboxed iframe`,
        });
        return;
      }
      if (data.type === "mcpr_action") {
        logAction(data.method, data.args);

        // Actually call backend MCP server for callTool actions (OpenAI path)
        if (data.method === "callTool" && data.args?.name && data.callId) {
          const iframe = useStore.getState()._iframeRef;
          callTool(data.args.name, data.args.arguments || {})
            .then((result) => {
              logAction("callTool:result", { name: data.args.name, result });
              iframe?.contentWindow?.postMessage(
                { type: "mcpr_tool_result", callId: data.callId, result },
                "*"
              );
            })
            .catch((err) => {
              logAction("callTool:error", {
                name: data.args.name,
                error: (err as Error).message,
              });
              iframe?.contentWindow?.postMessage(
                {
                  type: "mcpr_tool_result",
                  callId: data.callId,
                  result: { error: (err as Error).message },
                },
                "*"
              );
            });
        }

        // Capture follow-up messages from widget (OpenAI path)
        if (data.method === "sendFollowUpMessage") {
          addPendingMessage("openai", data.args);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [logAction, addPendingMessage]);

  // Listen for CSP violations from the iframe
  useEffect(() => {
    function handleViolation(event: SecurityPolicyViolationEvent) {
      const state = useStore.getState();
      const widgetName = state.resolveWidgetName();
      state.addCspViolation({
        id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: new Date().toTimeString().split(" ")[0],
        directive: event.violatedDirective,
        blockedUri: event.blockedURI || "(inline)",
        sourceFile:
          event.sourceFile || (widgetName ? `/widgets/${widgetName}.html` : ""),
        lineNumber: event.lineNumber || 0,
        columnNumber: event.columnNumber || 0,
        source: "runtime",
        severity: "error",
      });
    }

    // The securitypolicyviolation event fires on the document when CSP blocks something.
    // For srcdoc iframes, we try to listen on the iframe's document when accessible.
    function attachToIframe() {
      try {
        const iframe = useStore.getState()._iframeRef;
        const doc = iframe?.contentDocument;
        if (doc) {
          doc.addEventListener(
            "securitypolicyviolation",
            handleViolation as EventListener
          );
        }
      } catch {
        /* cross-origin — strict mode without allow-same-origin */
      }
    }

    // Also listen on the main document (some violations bubble up)
    document.addEventListener("securitypolicyviolation", handleViolation);

    // Re-attach after iframe loads
    const iframe = useStore.getState()._iframeRef;
    const onLoad = () => attachToIframe();
    iframe?.addEventListener("load", onLoad);
    attachToIframe();

    return () => {
      document.removeEventListener("securitypolicyviolation", handleViolation);
      iframe?.removeEventListener("load", onLoad);
      try {
        iframe?.contentDocument?.removeEventListener(
          "securitypolicyviolation",
          handleViolation as EventListener
        );
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Auto-resize fallback — adjusts iframe height to fit widget content within chat chrome
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const iframe = useStore.getState()._iframeRef;
        if (!iframe?.contentDocument) return;
        const h = iframe.contentDocument.documentElement.scrollHeight;
        if (h > 50 && Math.abs(iframe.offsetHeight - h) > 10) {
          iframe.style.height = `${h}px`;
        }
      } catch {
        /* cross-origin */
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const hasWidget = !!widgetName;
  const hasJson = !!jsonOutput || !!lastResult;
  const jsonText =
    jsonOutput || (lastResult ? JSON.stringify(lastResult, null, 2) : null);
  const showTabs = hasWidget && hasJson;

  // No widget and no JSON — empty state
  if (!hasWidget && !hasJson) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No widget to preview
      </div>
    );
  }

  // Only JSON, no widget
  if (!hasWidget && hasJson) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-secondary/50 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            JSON Response
          </span>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground select-text">
            {jsonText}
          </pre>
        </ScrollArea>
      </div>
    );
  }

  // Has widget (possibly also JSON result) — show tabs if both
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex border-b shrink-0">
        {showTabs && (
          <>
            <button
              onClick={() => setActiveTab("widget")}
              className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                activeTab === "widget"
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Widget
            </button>
            <button
              onClick={() => setActiveTab("json")}
              className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                activeTab === "json"
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              JSON
            </button>
          </>
        )}
        <div className="ml-auto flex items-center">
          <button
            onClick={() => useStore.getState().loadWidget()}
            className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            title="Reload widget HTML"
          >
            ↻ Reload
          </button>
        </div>
      </div>

      {/* Widget iframe — always mounted but hidden when JSON tab active */}
      <ViewportFrame
        hidden={showTabs && activeTab === "json"}
        refCallback={refCallback}
      />

      {/* JSON view */}
      {showTabs && activeTab === "json" && (
        <ScrollArea className="flex-1 min-h-0">
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground select-text">
            {jsonText}
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}
