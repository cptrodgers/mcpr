import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { RequestEditor } from "@/components/request-editor";
import { ActionLog } from "@/components/action-log";
import { PendingMessages } from "@/components/pending-messages";
import { WidgetConfig } from "@/components/widget-config";
import { WidgetPreview } from "@/components/widget-preview";
import { ResizableSplit } from "@/components/resizable-split";
import { Badge } from "@/components/ui/badge";

export function StudioLayout() {
  const selected = useStore((s) => s.selected);

  const headerLabel = selected
    ? selected.type === "widget"
      ? selected.name.replace(/_/g, " ")
      : selected.type === "tool"
        ? selected.tool.name.replace(/_/g, " ")
        : selected.resource.name || selected.resource.uri
    : "";

  const headerBadge = selected?.type === "tool"
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
              variant={selected?.type === "tool" ? "default" : selected?.type === "resource" ? "secondary" : "destructive"}
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
              <ActionLog />
            </div>
          }
          defaultRatio={0.6}
          minTopPx={120}
          minBottomPx={80}
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
