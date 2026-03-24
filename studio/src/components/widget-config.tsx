import { useStore } from "@/lib/store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Platform } from "@/lib/store";

export function WidgetConfig() {
  const {
    platform,
    theme,
    displayMode,
    locale,
    strictMode,
    cspViolations,
    setPlatform,
    setTheme,
    setDisplayMode,
    setLocale,
    setStrictMode,
  } = useStore();

  const errorCount = cspViolations.filter((v) => v.severity === "error").length;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b text-xs shrink-0 flex-wrap">
      <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
        <TabsList className="h-7">
          <TabsTrigger value="openai" className="text-xs px-2.5 h-5">
            OpenAI
          </TabsTrigger>
          <TabsTrigger value="claude" className="text-xs px-2.5 h-5">
            Claude
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="w-px h-4 bg-border" />

      <button
        onClick={() => setStrictMode(!strictMode)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
          strictMode
            ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
            : "bg-secondary text-muted-foreground hover:text-secondary-foreground hover:bg-secondary/80"
        }`}
        title={
          strictMode
            ? `Strict mode ON — enforcing ${platform === "openai" ? "ChatGPT" : "Claude"} CSP`
            : "Enable strict mode to enforce production CSP restrictions"
        }
      >
        <span
          className={`inline-block w-2 h-2 rounded-full ${strictMode ? "bg-blue-400" : "bg-muted-foreground/40"}`}
        />
        Strict
        {errorCount > 0 && (
          <span className="px-1 py-0 rounded-full bg-red-500/20 text-red-400 text-[10px] font-semibold">
            {errorCount}
          </span>
        )}
      </button>

      <div className="w-px h-4 bg-border" />

      <label className="text-muted-foreground">Theme</label>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs border-0"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>

      <label className="text-muted-foreground">Display</label>
      <select
        value={displayMode}
        onChange={(e) => setDisplayMode(e.target.value)}
        className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs border-0"
      >
        <option value="compact">Compact</option>
        <option value="inline">Inline</option>
        <option value="fullscreen">Fullscreen</option>
      </select>

      <label className="text-muted-foreground">Locale</label>
      <input
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs w-14 border-0"
      />
    </div>
  );
}
