import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Platform = "openai" | "claude";

interface WidgetConfigProps {
  platform: Platform;
  onPlatformChange: (p: Platform) => void;
  theme: string;
  onThemeChange: (v: string) => void;
  displayMode: string;
  onDisplayModeChange: (v: string) => void;
  locale: string;
  onLocaleChange: (v: string) => void;
}

export function WidgetConfig({
  platform,
  onPlatformChange,
  theme,
  onThemeChange,
  displayMode,
  onDisplayModeChange,
  locale,
  onLocaleChange,
}: WidgetConfigProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b text-xs shrink-0 flex-wrap">
      <Tabs value={platform} onValueChange={(v) => onPlatformChange(v as Platform)}>
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

      <label className="text-muted-foreground">Theme</label>
      <select
        value={theme}
        onChange={(e) => onThemeChange(e.target.value)}
        className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs border-0"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>

      <label className="text-muted-foreground">Display</label>
      <select
        value={displayMode}
        onChange={(e) => onDisplayModeChange(e.target.value)}
        className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs border-0"
      >
        <option value="compact">Compact</option>
        <option value="inline">Inline</option>
        <option value="fullscreen">Fullscreen</option>
      </select>

      <label className="text-muted-foreground">Locale</label>
      <input
        value={locale}
        onChange={(e) => onLocaleChange(e.target.value)}
        className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs w-14 border-0"
      />
    </div>
  );
}
