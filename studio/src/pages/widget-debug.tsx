import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { getRawWidgetUrl } from "@/lib/api";
import { buildOpenAIMockScript, DEFAULT_MOCK, type MockData } from "@/lib/mock-openai";
import { createClaudeMock } from "@/lib/mock-claude";

type Platform = "openai" | "claude";

interface ActionEntry {
  time: string;
  method: string;
  args: string;
}

export function WidgetDebugPage() {
  const { name } = useParams({ from: "/widgets/$name" });
  const displayName = name.replace(/_/g, " ");

  const [platform, setPlatform] = useState<Platform>("openai");
  const [theme, setTheme] = useState("dark");
  const [locale, setLocale] = useState("en-US");
  const [displayMode, setDisplayMode] = useState("compact");
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [editorValue, setEditorValue] = useState(
    JSON.stringify({ toolInput: DEFAULT_MOCK.toolInput, toolOutput: DEFAULT_MOCK.toolOutput, _meta: DEFAULT_MOCK._meta, widgetState: DEFAULT_MOCK.widgetState }, null, 2)
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const claudeMockRef = useRef<ReturnType<typeof createClaudeMock> | null>(null);
  const actionLogRef = useRef<HTMLDivElement>(null);

  const logAction = useCallback((method: string, args: unknown) => {
    const now = new Date();
    const time = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);
    setActions((prev) => [...prev, { time, method, args: argsStr }]);
  }, []);

  const getMock = useCallback((): MockData | null => {
    try {
      const parsed = JSON.parse(editorValue);
      return {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
      return null;
    }
  }, [editorValue, theme, locale, displayMode, logAction]);

  // Load widget into iframe
  const loadWidget = useCallback(async () => {
    const mock = getMock();
    if (!mock) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Cleanup previous Claude mock
    claudeMockRef.current?.destroy();
    claudeMockRef.current = null;

    if (platform === "openai") {
      const resp = await fetch(getRawWidgetUrl(name));
      const html = await resp.text();
      const mockScript = buildOpenAIMockScript(mock);
      const injected = html.replace(/<head([^>]*)>/i, `<head$1>${mockScript}`);
      iframe.srcdoc = injected;
    } else {
      // Claude — set up postMessage handler before loading
      claudeMockRef.current = createClaudeMock(iframe, mock, logAction);
      iframe.removeAttribute("srcdoc");
      iframe.src = getRawWidgetUrl(name);
    }
  }, [platform, name, getMock, logAction]);

  // Apply data update without full reload
  const applyUpdate = useCallback(() => {
    const mock = getMock();
    if (!mock) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (platform === "openai") {
      try {
        const win = iframe.contentWindow;
        if (!win || !(win as unknown as { openai: unknown }).openai) {
          loadWidget();
          return;
        }
        const openai = (win as unknown as { openai: Record<string, unknown> }).openai;
        openai.toolInput = mock.toolInput;
        openai.toolOutput = mock.toolOutput;
        openai.toolResponseMetadata = mock._meta;
        openai.widgetState = mock.widgetState;
        openai.theme = mock.theme;
        openai.locale = mock.locale;
        openai.displayMode = mock.displayMode;
        win.dispatchEvent(new CustomEvent("openai:set_globals"));
        logAction("system", "Data updated via openai:set_globals");
      } catch {
        loadWidget();
      }
    } else {
      claudeMockRef.current?.update(mock);
      logAction("system", "Data updated via tool-result notification");
    }
  }, [platform, getMock, loadWidget, logAction]);

  // Listen for messages from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data) return;

      if (data.type === "mcpr_resize" && data.height) {
        const iframe = iframeRef.current;
        if (iframe) iframe.style.height = `${data.height}px`;
        return;
      }

      if (data.type === "mcpr_action") {
        logAction(data.method, data.args);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [logAction]);

  // Auto-resize fallback
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const iframe = iframeRef.current;
        if (!iframe?.contentDocument) return;
        const h = iframe.contentDocument.documentElement.scrollHeight;
        if (h > 50 && Math.abs(iframe.offsetHeight - h) > 10) {
          iframe.style.height = `${h}px`;
        }
      } catch {
        /* cross-origin */
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Load on mount and platform change
  useEffect(() => {
    loadWidget();
  }, [platform, name]);

  // Auto-scroll action log
  useEffect(() => {
    actionLogRef.current?.scrollTo({ top: actionLogRef.current.scrollHeight });
  }, [actions]);

  return (
    <div className="h-screen flex flex-col">
      {/* Nav */}
      <div className="flex items-center gap-2 px-4 py-2 border-b text-sm shrink-0">
        <Link to="/" className="flex items-center gap-1.5 text-primary hover:underline">
          <img src="/studio/logo.svg" alt="mcpr" className="w-4 h-4" />
          ← Widgets
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold">{displayName}</span>
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          DEBUG
        </Badge>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Widget pane */}
        <div className="flex-1 flex flex-col border-r min-w-0">
          {/* Platform tabs */}
          <div className="px-4 py-2 border-b shrink-0">
            <Tabs
              value={platform}
              onValueChange={(v) => setPlatform(v as Platform)}
            >
              <TabsList className="h-8">
                <TabsTrigger value="openai" className="text-xs px-3 h-6">
                  OpenAI
                </TabsTrigger>
                <TabsTrigger value="claude" className="text-xs px-3 h-6">
                  Claude
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Conversation view */}
          <div className="flex-1 overflow-y-auto bg-[#212121]">
            <div className="max-w-[680px] mx-auto py-6 px-4">
              <div className="flex gap-3 mb-4">
                <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">
                  ✦
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-neutral-300 mb-1.5">
                    {platform === "openai" ? "ChatGPT" : "Claude"}
                  </p>
                  <p className="text-sm text-neutral-400 mb-3">
                    Here are the details:
                  </p>
                  <div className="rounded-2xl border border-neutral-700 overflow-hidden bg-neutral-800/50">
                    <iframe
                      ref={iframeRef}
                      className="w-full border-none block"
                      style={{ minHeight: "200px" }}
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Debug pane */}
        <div className="w-[420px] shrink-0 flex flex-col">
          {/* Controls */}
          <div className="flex items-center gap-3 px-3 py-2 border-b text-xs shrink-0">
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

          {/* Mock data editor */}
          <div className="flex-[3] flex flex-col min-h-0 border-b">
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Mock Data
              </span>
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => {
                    setEditorValue(JSON.stringify({ toolInput: DEFAULT_MOCK.toolInput, toolOutput: DEFAULT_MOCK.toolOutput, _meta: DEFAULT_MOCK._meta, widgetState: DEFAULT_MOCK.widgetState }, null, 2));
                    setTimeout(loadWidget, 50);
                  }}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={applyUpdate}
                >
                  ▶ Apply
                </Button>
              </div>
            </div>
            <Textarea
              className="flex-1 min-h-0 rounded-none border-0 resize-none font-mono text-xs focus-visible:ring-0 bg-background"
              value={editorValue}
              onChange={(e) => setEditorValue(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Action log */}
          <div className="flex-[2] flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Action Log
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setActions([])}
              >
                Clear
              </Button>
            </div>
            <ScrollArea className="flex-1" ref={actionLogRef}>
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
                      <span className="text-muted-foreground mr-2">
                        {a.time}
                      </span>
                      <span className="text-purple-400 font-semibold">
                        {a.method}
                      </span>
                      <span className="text-muted-foreground ml-1 break-all">
                        {a.args.length > 120
                          ? a.args.slice(0, 120) + "…"
                          : a.args}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
