import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchWidgets, getBaseUrl, isRemoteProxy, type WidgetInfo } from "@/lib/api";

export function WidgetListPage() {
  const [widgets, setWidgets] = useState<WidgetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWidgets()
      .then(setWidgets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex items-center gap-3">
        <img src="/studio/logo.svg" alt="mcpr" className="w-8 h-8" />
        <div>
          <h1 className="text-2xl font-bold">mcpr studio</h1>
          <p className="text-muted-foreground text-sm">
            Preview and debug MCP widgets
          </p>
          {isRemoteProxy() && (
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Connected to {getBaseUrl()}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <p className="text-muted-foreground">Loading widgets…</p>
      )}

      {error && (
        <p className="text-destructive">
          Failed to load widgets: {error}
        </p>
      )}

      {!loading && widgets.length === 0 && !error && (
        <p className="text-muted-foreground">
          No widgets found. Make sure mcpr is running with a widget source configured.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {widgets.map((w) => (
          <Link
            key={w.name}
            to="/widgets/$name"
            params={{ name: w.name }}
            className="block"
          >
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">
                    {w.name.replace(/_/g, " ")}
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    widget
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {w.name}
                </p>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
