import { useEffect, useRef, useState } from "react";
import { useStore, type ActionEntry } from "@/lib/store";
import { Button } from "@/components/ui/button";

function LogEntry({ entry, index }: { entry: ActionEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLong = entry.args.length > 120;

  const copyToClipboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${entry.time} ${entry.method} ${entry.args}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      key={index}
      className={`px-3 py-1 text-xs font-mono border-b border-border/30 group ${
        isLong ? "cursor-pointer hover:bg-secondary/50" : ""
      }`}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <div className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <span className="text-muted-foreground mr-2">{entry.time}</span>
          <span className="text-purple-400 font-semibold">{entry.method}</span>
          {isLong && (
            <span className="text-muted-foreground/50 ml-1 text-[10px]">
              {expanded ? "▼" : "▶"}
            </span>
          )}
          <span className="text-muted-foreground ml-1 break-all">
            {expanded || !isLong ? entry.args : entry.args.slice(0, 120) + "…"}
          </span>
        </div>
        <button
          onClick={copyToClipboard}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground text-xs px-1.5 py-0.5 rounded hover:bg-secondary transition-opacity"
          title="Copy full log entry"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

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
              <LogEntry key={i} entry={a} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
