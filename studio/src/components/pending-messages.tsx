import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

export function PendingMessages() {
  const { pendingMessages, dismissMessage, clearMessages } = useStore();

  if (pendingMessages.length === 0) return null;

  return (
    <div className="border-b bg-yellow-500/10 shrink-0">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-yellow-500">
          Widget Messages ({pendingMessages.length})
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2 text-yellow-500 hover:text-yellow-400"
          onClick={clearMessages}
        >
          Clear all
        </Button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {pendingMessages.map((msg) => (
          <div
            key={msg.id}
            className="px-3 py-2 border-t border-yellow-500/20 text-xs font-mono group hover:bg-yellow-500/5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-muted-foreground">{msg.time}</span>
                  <span className="text-yellow-500 font-semibold text-[10px] uppercase">
                    {msg.source}
                  </span>
                </div>
                <pre className="text-foreground whitespace-pre-wrap break-all text-xs">
                  {typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content, null, 2)}
                </pre>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => dismissMessage(msg.id)}
              >
                ×
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
