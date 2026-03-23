import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RequestEditor() {
  const { selected, editorValue, executing, setEditorValue, resetEditor, applyMock, execute } = useStore();

  const label = selected?.type === "tool"
    ? "Tool Arguments"
    : selected?.type === "resource"
      ? "Resource Request"
      : "Mock Data";

  const isWidget = selected?.type === "widget";
  const showExecute = selected?.type === "tool" || selected?.type === "resource";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={resetEditor}>
            Reset
          </Button>
          {isWidget && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={applyMock}>
              ▶ Mock
            </Button>
          )}
          {showExecute && (
            <Button size="sm" className="h-6 text-xs px-2" onClick={execute} disabled={executing}>
              {executing ? "…" : "⚡ Execute"}
            </Button>
          )}
        </div>
      </div>
      <Textarea
        className="flex-1 min-h-0 rounded-none border-0 resize-none font-mono text-xs focus-visible:ring-0 bg-background"
        value={editorValue}
        onChange={(e) => setEditorValue(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
