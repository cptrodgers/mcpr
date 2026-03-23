import { forwardRef } from "react";

interface WidgetPreviewProps {
  name: string | null;
}

export const WidgetPreview = forwardRef<HTMLIFrameElement, WidgetPreviewProps>(
  function WidgetPreview({ name }, ref) {
    if (!name) {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Select a widget to preview
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto flex items-start justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-neutral-700 overflow-hidden bg-neutral-800/50">
          <iframe
            ref={ref}
            className="w-full border-none block"
            style={{ minHeight: "200px" }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        </div>
      </div>
    );
  }
);
