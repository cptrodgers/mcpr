import { useCallback, useRef, useState, type ReactNode } from "react";

interface ResizableSplitProps {
  top: ReactNode;
  bottom: ReactNode;
  defaultRatio?: number;
  minTopPx?: number;
  minBottomPx?: number;
}

export function ResizableSplit({
  top,
  bottom,
  defaultRatio = 0.55,
  minTopPx = 100,
  minBottomPx = 80,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const total = rect.height;
        const clamped = Math.max(minTopPx, Math.min(total - minBottomPx, y));
        setRatio(clamped / total);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [minTopPx, minBottomPx]
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <div
        className="flex flex-col min-h-0 overflow-hidden"
        style={{ flex: `0 0 ${ratio * 100}%` }}
      >
        {top}
      </div>
      <div
        onMouseDown={onMouseDown}
        className="shrink-0 h-1 cursor-row-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      />
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {bottom}
      </div>
    </div>
  );
}
