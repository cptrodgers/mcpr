import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { RequestEditor } from "@/components/request-editor";
import { ActionLog } from "@/components/action-log";
import { PendingMessages } from "@/components/pending-messages";
import { WidgetConfig } from "@/components/widget-config";
import { WidgetPreview } from "@/components/widget-preview";
import { CspPanel } from "@/components/csp-panel";
import { OAuthDebugger } from "@/components/oauth-debugger";
import { ResizableSplit } from "@/components/resizable-split";
import { Badge } from "@/components/ui/badge";

type BottomTab = "logs" | "csp" | "oauth";

export function StudioLayout() {
  const selected = useStore((s) => s.selected);
  const cspViolations = useStore((s) => s.cspViolations);
  const oauthDebugEvents = useStore((s) => s.oauthDebugEvents);
  const oauthDebugOpen = useStore((s) => s.oauthDebugOpen);
  const setOAuthDebugOpen = useStore((s) => s.setOAuthDebugOpen);
  const [bottomTab, setBottomTab] = useState<BottomTab>("logs");

  // Auto-switch to OAuth tab when debugger is opened from auth panel
  const prevDebugOpen = useRef(oauthDebugOpen);
  useEffect(() => {
    if (oauthDebugOpen && !prevDebugOpen.current) {
      setBottomTab("oauth");
    }
    prevDebugOpen.current = oauthDebugOpen;
  }, [oauthDebugOpen]);

  const headerLabel = selected
    ? selected.type === "widget"
      ? selected.name.replace(/_/g, " ")
      : selected.type === "tool"
        ? selected.tool.name.replace(/_/g, " ")
        : selected.resource.name || selected.resource.uri
    : "";

  const headerBadge =
    selected?.type === "tool"
      ? "TOOL"
      : selected?.type === "resource"
        ? "RESOURCE"
        : selected?.type === "widget"
          ? "WIDGET"
          : null;

  return (
    <div className="h-screen flex">
      <Sidebar />

      {/* Middle column */}
      <div className="flex-1 flex flex-col border-r min-w-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
          <span className="font-semibold text-sm truncate">{headerLabel}</span>
          {headerBadge && (
            <Badge
              variant={
                selected?.type === "tool"
                  ? "default"
                  : selected?.type === "resource"
                    ? "secondary"
                    : "destructive"
              }
              className="text-[10px] px-1.5 py-0"
            >
              {headerBadge}
            </Badge>
          )}
        </div>
        <ResizableSplit
          top={<RequestEditor />}
          bottom={
            <div className="flex-1 flex flex-col min-h-0">
              <PendingMessages />
              <div className="flex border-b shrink-0">
                <button
                  onClick={() => setBottomTab("logs")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    bottomTab === "logs"
                      ? "text-foreground border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setBottomTab("csp")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                    bottomTab === "csp"
                      ? "text-foreground border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Sandbox Enforcement
                  {cspViolations.length > 0 && (
                    <span
                      className={`px-1.5 py-0 rounded-full text-[10px] font-semibold ${
                        cspViolations.some((v) => v.severity === "error")
                          ? "bg-red-500/20 text-red-400"
                          : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {cspViolations.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    setBottomTab("oauth");
                    setOAuthDebugOpen(true);
                  }}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                    bottomTab === "oauth"
                      ? "text-foreground border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  OAuth
                  {oauthDebugEvents.length > 0 && (
                    <span
                      className={`px-1.5 py-0 rounded-full text-[10px] font-semibold ${
                        oauthDebugEvents.some((e) => e.status === "error")
                          ? "bg-red-500/20 text-red-400"
                          : "bg-green-500/20 text-green-400"
                      }`}
                    >
                      {oauthDebugEvents.length}
                    </span>
                  )}
                </button>
              </div>
              {bottomTab === "logs" ? (
                <ActionLog />
              ) : bottomTab === "csp" ? (
                <CspPanel />
              ) : (
                <OAuthDebugger />
              )}
            </div>
          }
          defaultRatio={0.4}
          minTopPx={100}
          minBottomPx={200}
        />
      </div>

      {/* Right column */}
      <div className="flex-1 flex flex-col min-w-0">
        <WidgetConfig />
        <WidgetPreview />
      </div>
    </div>
  );
}
