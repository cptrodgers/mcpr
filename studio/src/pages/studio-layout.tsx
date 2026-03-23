import { useCallback, useEffect, useRef, useState } from "react";
import { WidgetSidebar } from "@/components/widget-sidebar";
import { RequestEditor } from "@/components/request-editor";
import { ActionLog, type ActionEntry } from "@/components/action-log";
import { WidgetConfig } from "@/components/widget-config";
import { WidgetPreview } from "@/components/widget-preview";
import { Badge } from "@/components/ui/badge";
import { getRawWidgetUrl } from "@/lib/api";
import { buildOpenAIMockScript, DEFAULT_MOCK, type MockData } from "@/lib/mock-openai";
import { createClaudeMock } from "@/lib/mock-claude";

type Platform = "openai" | "claude";

export function StudioLayout() {
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("openai");
  const [theme, setTheme] = useState("dark");
  const [locale, setLocale] = useState("en-US");
  const [displayMode, setDisplayMode] = useState("compact");
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [editorValue, setEditorValue] = useState(
    JSON.stringify(
      {
        toolInput: DEFAULT_MOCK.toolInput,
        toolOutput: DEFAULT_MOCK.toolOutput,
        _meta: DEFAULT_MOCK._meta,
        widgetState: DEFAULT_MOCK.widgetState,
      },
      null,
      2
    )
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const claudeMockRef = useRef<ReturnType<typeof createClaudeMock> | null>(null);

  const logAction = useCallback((method: string, args: unknown) => {
    const now = new Date();
    const time =
      now.toTimeString().split(" ")[0] +
      "." +
      String(now.getMilliseconds()).padStart(3, "0");
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

  const loadWidget = useCallback(async () => {
    if (!selectedWidget) return;
    const mock = getMock();
    if (!mock) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    claudeMockRef.current?.destroy();
    claudeMockRef.current = null;

    if (platform === "openai") {
      const resp = await fetch(getRawWidgetUrl(selectedWidget));
      const html = await resp.text();
      const mockScript = buildOpenAIMockScript(mock);
      const injected = html.replace(/<head([^>]*)>/i, `<head$1>${mockScript}`);
      iframe.srcdoc = injected;
    } else {
      claudeMockRef.current = createClaudeMock(iframe, mock, logAction);
      iframe.removeAttribute("srcdoc");
      iframe.src = getRawWidgetUrl(selectedWidget);
    }
  }, [platform, selectedWidget, getMock, logAction]);

  const applyUpdate = useCallback(() => {
    if (!selectedWidget) return;
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
        const openai = (win as unknown as { openai: Record<string, unknown> })
          .openai;
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
  }, [platform, selectedWidget, getMock, loadWidget, logAction]);

  // Listen for iframe messages
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

  // Load on widget/platform change
  useEffect(() => {
    if (selectedWidget) {
      setActions([]);
      loadWidget();
    }
  }, [platform, selectedWidget]);

  const handleSelectWidget = useCallback((name: string) => {
    setSelectedWidget(name);
  }, []);

  const handleReset = useCallback(() => {
    setEditorValue(
      JSON.stringify(
        {
          toolInput: DEFAULT_MOCK.toolInput,
          toolOutput: DEFAULT_MOCK.toolOutput,
          _meta: DEFAULT_MOCK._meta,
          widgetState: DEFAULT_MOCK.widgetState,
        },
        null,
        2
      )
    );
    setTimeout(loadWidget, 50);
  }, [loadWidget]);

  const displayName = selectedWidget?.replace(/_/g, " ") ?? "";

  return (
    <div className="h-screen flex">
      {/* Left sidebar */}
      <WidgetSidebar selected={selectedWidget} onSelect={handleSelectWidget} />

      {/* Middle column */}
      <div className="flex-1 flex flex-col border-r min-w-0">
        {/* Widget name header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
          <span className="font-semibold text-sm truncate">{displayName}</span>
          {selectedWidget && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              DEBUG
            </Badge>
          )}
        </div>

        {/* Request editor + Logs stacked */}
        <RequestEditor
          value={editorValue}
          onChange={setEditorValue}
          onReset={handleReset}
          onApply={applyUpdate}
        />
        <ActionLog actions={actions} onClear={() => setActions([])} />
      </div>

      {/* Right column */}
      <div className="flex-1 flex flex-col min-w-0">
        <WidgetConfig
          platform={platform}
          onPlatformChange={setPlatform}
          theme={theme}
          onThemeChange={setTheme}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          locale={locale}
          onLocaleChange={setLocale}
        />
        <WidgetPreview ref={iframeRef} name={selectedWidget} />
      </div>
    </div>
  );
}
