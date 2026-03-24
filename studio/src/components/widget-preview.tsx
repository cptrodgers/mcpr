import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { callTool } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";

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

  // Auto-resize fallback
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
      <div
        className={`flex-1 overflow-y-auto flex items-start justify-center p-6 ${
          showTabs && activeTab === "json" ? "hidden" : ""
        }`}
      >
        <div className="w-full max-w-md rounded-2xl border border-border overflow-hidden bg-secondary/50">
          <iframe
            ref={refCallback}
            className="w-full border-none block"
            style={{ minHeight: "200px" }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        </div>
      </div>

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
