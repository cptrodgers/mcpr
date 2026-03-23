import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface RequestEditorProps {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  onApply: () => void;
}

export function RequestEditor({ value, onChange, onReset, onApply }: RequestEditorProps) {
  return (
    <div className="flex-[3] flex flex-col min-h-0 border-b">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Request Editor
        </span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onReset}>
            Reset
          </Button>
          <Button size="sm" className="h-6 text-xs px-2" onClick={onApply}>
            ▶ Apply
          </Button>
        </div>
      </div>
      <Textarea
        className="flex-1 min-h-0 rounded-none border-0 resize-none font-mono text-xs focus-visible:ring-0 bg-background"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
