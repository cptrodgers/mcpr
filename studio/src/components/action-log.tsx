import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

export function ActionLog() {
  const { actions, clearActions } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [actions]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Logs
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={clearActions}>
          Clear
        </Button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {actions.length === 0 ? (
          <p className="text-center text-muted-foreground text-xs py-6">
            Waiting for widget actions…
          </p>
        ) : (
          <div className="py-1">
            {actions.map((a, i) => (
              <div
                key={i}
                className="px-3 py-1 text-xs font-mono hover:bg-secondary/50 border-b border-border/30"
              >
                <span className="text-muted-foreground mr-2">{a.time}</span>
                <span className="text-purple-400 font-semibold">{a.method}</span>
                <span className="text-muted-foreground ml-1 break-all">
                  {a.args.length > 120 ? a.args.slice(0, 120) + "…" : a.args}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
