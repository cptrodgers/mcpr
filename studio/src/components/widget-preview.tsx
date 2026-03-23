import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";

type Tab = "widget" | "json";

export function WidgetPreview() {
  const { jsonOutput, lastResult, resolveWidgetName, setIframeRef, logAction } = useStore();
  const widgetName = resolveWidgetName();
  const [activeTab, setActiveTab] = useState<Tab>("widget");

  // Auto-switch to widget tab when widget renders, json tab when no widget
  useEffect(() => {
    if (widgetName && lastResult) setActiveTab("widget");
    else if (!widgetName && jsonOutput) setActiveTab("json");
  }, [widgetName, lastResult, jsonOutput]);

  const refCallback = useCallback((el: HTMLIFrameElement | null) => {
    setIframeRef(el);
  }, [setIframeRef]);

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
      if (data.type === "mcpr_action") {
        logAction(data.method, data.args);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [logAction]);

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
      } catch { /* cross-origin */ }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const hasWidget = !!widgetName;
  const hasJson = !!jsonOutput || !!lastResult;
  const jsonText = jsonOutput || (lastResult ? JSON.stringify(lastResult, null, 2) : null);
  const showTabs = hasWidget && hasJson;

  // No widget and no JSON — empty state
  if (!hasWidget && !hasJson) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a widget to preview
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
        <ScrollArea className="flex-1">
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground">{jsonText}</pre>
        </ScrollArea>
      </div>
    );
  }

  // Has widget (possibly also JSON result) — show tabs if both
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {showTabs && (
        <div className="flex border-b shrink-0">
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
        </div>
      )}

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
        <ScrollArea className="flex-1">
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground">{jsonText}</pre>
        </ScrollArea>
      )}
    </div>
  );
}
