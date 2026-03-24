import { useStore, type CspViolation } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

const DOCS: Record<string, { label: string; url: string }> = {
  openai: {
    label: "OpenAI Widget Docs",
    url: "https://platform.openai.com/docs/guides/tools-remote/widget-rendering",
  },
  claude: {
    label: "MCP Apps Docs",
    url: "https://modelcontextprotocol.io/extensions/apps/build",
  },
};

function ViolationEntry({ v }: { v: CspViolation }) {
  const [expanded, setExpanded] = useState(false);

  const icon = v.severity === "error" ? "\u2715" : "!";
  const iconColor = v.severity === "error" ? "text-red-400" : "text-yellow-400";
  const sourceLabel = v.source === "static" ? "static" : "runtime";

  return (
    <div
      className="px-3 py-1.5 text-xs font-mono border-b border-border/30 cursor-pointer hover:bg-secondary/50"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <span className={`${iconColor} font-bold shrink-0 w-4 text-center`}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-purple-400 font-semibold">{v.directive}</span>
          <span className="text-muted-foreground ml-2 break-all">
            {v.blockedUri || "(inline)"}
          </span>
          <span className="text-muted-foreground/50 ml-2 text-[10px]">
            [{sourceLabel}]
          </span>
          {v.platforms && v.platforms.length > 0 && (
            <span className="text-muted-foreground/50 ml-1 text-[10px]">
              {v.platforms.join(", ")}
            </span>
          )}
          {expanded && (
            <div className="mt-1.5 space-y-1">
              {v.fix && <div className="text-green-400/80">Fix: {v.fix}</div>}
              {v.sourceFile && (
                <div className="text-muted-foreground">
                  Source: {v.sourceFile}
                  {v.lineNumber > 0 && `:${v.lineNumber}`}
                  {v.columnNumber > 0 && `:${v.columnNumber}`}
                </div>
              )}
              {v.lineNumber > 0 && !v.sourceFile && (
                <div className="text-muted-foreground">
                  Line: {v.lineNumber}
                </div>
              )}
            </div>
          )}
        </div>
        <span className="text-muted-foreground/50 text-[10px] shrink-0">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
      </div>
    </div>
  );
}

export function CspPanel() {
  const { cspViolations, clearCspViolations, strictMode, platform } =
    useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [cspViolations]);

  const errorCount = cspViolations.filter((v) => v.severity === "error").length;
  const warnCount = cspViolations.filter(
    (v) => v.severity === "warning"
  ).length;
  const doc = DOCS[platform] || DOCS.openai;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sandbox Enforcement
          </span>
          {cspViolations.length > 0 && (
            <span className="flex items-center gap-1">
              {errorCount > 0 && (
                <span className="text-[10px] px-1.5 py-0 rounded-full bg-red-500/20 text-red-400 font-semibold">
                  {errorCount} {errorCount === 1 ? "error" : "errors"}
                </span>
              )}
              {warnCount > 0 && (
                <span className="text-[10px] px-1.5 py-0 rounded-full bg-yellow-500/20 text-yellow-400 font-semibold">
                  {warnCount} {warnCount === 1 ? "warning" : "warnings"}
                </span>
              )}
            </span>
          )}
          {strictMode && (
            <span className="text-[10px] px-1.5 py-0 rounded-full bg-blue-500/20 text-blue-400 font-semibold">
              strict
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {doc.label} {"\u2197"}
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={clearCspViolations}
          >
            Clear
          </Button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {cspViolations.length === 0 ? (
          <div className="text-center text-muted-foreground text-xs py-6 space-y-2">
            <p>
              {strictMode
                ? "No sandbox violations detected"
                : "Enable strict mode to enforce production sandbox restrictions, or run a widget to see static analysis"}
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              <a
                href={DOCS.openai.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors underline"
              >
                OpenAI Widget Rendering
              </a>
              {" \u00B7 "}
              <a
                href={DOCS.claude.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors underline"
              >
                MCP Apps Build Guide
              </a>
            </p>
          </div>
        ) : (
          <div className="py-1">
            {cspViolations.map((v) => (
              <ViolationEntry key={v.id} v={v} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
