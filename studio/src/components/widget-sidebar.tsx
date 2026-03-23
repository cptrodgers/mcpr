import { useEffect, useState } from "react";
import { fetchWidgets, isRemoteProxy, getBaseUrl, type WidgetInfo } from "@/lib/api";

interface WidgetSidebarProps {
  selected: string | null;
  onSelect: (name: string) => void;
}

export function WidgetSidebar({ selected, onSelect }: WidgetSidebarProps) {
  const [widgets, setWidgets] = useState<WidgetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWidgets()
      .then((w) => {
        setWidgets(w);
        if (w.length > 0 && !selected) onSelect(w[0].name);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="w-56 shrink-0 border-r flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <img src="/studio/logo.svg" alt="mcpr" className="w-6 h-6" />
          <span className="font-semibold text-sm">mcpr studio</span>
        </div>
        {isRemoteProxy() && (
          <p className="text-[10px] text-muted-foreground font-mono mt-1 truncate">
            {getBaseUrl()}
          </p>
        )}
      </div>

      {/* Widget list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <p className="text-muted-foreground text-xs px-4 py-3">Loading…</p>
        )}
        {error && (
          <p className="text-destructive text-xs px-4 py-3">{error}</p>
        )}
        {!loading && widgets.length === 0 && !error && (
          <p className="text-muted-foreground text-xs px-4 py-3">
            No widgets found.
          </p>
        )}
        {widgets.map((w) => (
          <button
            key={w.name}
            onClick={() => onSelect(w.name)}
            className={`w-full text-left px-4 py-2 text-sm hover:bg-secondary/50 transition-colors ${
              selected === w.name
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground"
            }`}
          >
            {w.name.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t shrink-0 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <a
            href="https://mcpr.app"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            mcpr.app
          </a>
          <span>·</span>
          <a
            href="https://github.com/cptrodgers/mcpr"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
