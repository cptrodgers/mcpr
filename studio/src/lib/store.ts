import { create } from "zustand";
import {
  fetchWidgets,
  getBaseUrl,
  getAuthToken,
  setAuthToken as persistAuthToken,
  listTools,
  listResources,
  callTool,
  readResource,
  getRawWidgetUrl,
  type WidgetInfo,
  type McpToolInfo,
  type McpResourceInfo,
} from "./api";
import {
  buildOpenAIMockScript,
  DEFAULT_MOCK,
  type MockData,
} from "./mock-openai";
import { createClaudeMock } from "./mock-claude";
import {
  buildCspMetaTag,
  extractCspDomains,
  getProfile,
  buildSandboxTrapScript,
} from "./csp-profiles";
import { analyzeHtml } from "./csp-checker";

// ── Types ──

export type Platform = "openai" | "claude";

export type ViewportPreset = "desktop" | "tablet" | "mobile" | "custom";

export interface ViewportSize {
  width: number;
  height: number;
}

export const VIEWPORT_PRESETS: Record<
  Exclude<ViewportPreset, "custom">,
  ViewportSize
> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 430, height: 932 },
};

export type SelectedItem =
  | { type: "widget"; name: string }
  | { type: "tool"; tool: McpToolInfo }
  | { type: "resource"; resource: McpResourceInfo };

export interface ActionEntry {
  time: string;
  method: string;
  args: string;
}

export interface PendingMessage {
  id: string;
  time: string;
  source: "openai" | "claude";
  content: unknown;
}

export interface CspViolation {
  id: string;
  time: string;
  /** The directive that was violated (e.g. "script-src") */
  directive: string;
  /** The URI that was blocked */
  blockedUri: string;
  /** Source file where the violation occurred */
  sourceFile: string;
  /** Line number in source */
  lineNumber: number;
  /** Column number in source */
  columnNumber: number;
  /** Whether this came from runtime (browser) or static analysis */
  source: "runtime" | "static";
  /** Human-readable fix suggestion (for static issues) */
  fix?: string;
  /** Severity */
  severity: "error" | "warning";
  /** Which platforms are affected */
  platforms?: string[];
}

// ── Helpers ──

function defaultEditorValue() {
  return JSON.stringify(
    {
      toolInput: DEFAULT_MOCK.toolInput,
      toolOutput: DEFAULT_MOCK.toolOutput,
      _meta: DEFAULT_MOCK._meta,
      widgetState: DEFAULT_MOCK.widgetState,
    },
    null,
    2
  );
}

interface JsonSchemaProperty {
  type?: string;
  default?: unknown;
  examples?: unknown[];
  example?: unknown;
  enum?: unknown[];
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

function sampleValue(key: string, prop: JsonSchemaProperty): unknown {
  if (prop.default !== undefined) return prop.default;
  if (prop.examples?.length) return prop.examples[0];
  if (prop.example !== undefined) return prop.example;
  if (prop.enum?.length) return prop.enum[0];

  if (prop.format === "date") return "2026-01-15";
  if (prop.format === "date-time") return "2026-01-15T10:30:00Z";
  if (prop.format === "email") return "user@example.com";
  if (prop.format === "uri" || prop.format === "url")
    return "https://example.com";
  if (prop.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";

  if (prop.type === "string") {
    const k = key.toLowerCase();
    if (k.includes("name")) return "example";
    if (k.includes("id")) return "abc-123";
    if (k.includes("email")) return "user@example.com";
    if (k.includes("url") || k.includes("uri")) return "https://example.com";
    if (k.includes("lang") || k.includes("locale")) return "en-US";
    if (k.includes("query") || k.includes("search") || k.includes("question"))
      return "sample query";
    if (k.includes("message") || k.includes("text") || k.includes("content"))
      return "Hello world";
    if (k.includes("description")) return "A sample description";
    if (k.includes("title")) return "Sample Title";
    if (prop.description) return `<${prop.description.slice(0, 30)}>`;
    return "example";
  }
  if (prop.type === "number" || prop.type === "integer") {
    if (prop.minimum !== undefined) return prop.minimum;
    if (prop.maximum !== undefined) return Math.min(prop.maximum, 10);
    return prop.type === "integer" ? 1 : 1.0;
  }
  if (prop.type === "boolean") return true;
  if (prop.type === "array") {
    if (prop.items) return [sampleValue("item", prop.items)];
    return [];
  }
  if (prop.type === "object") {
    if (prop.properties)
      return sampleFromProperties(prop.properties, prop.required);
    return {};
  }
  return null;
}

function sampleFromProperties(
  properties: Record<string, JsonSchemaProperty>,
  required?: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    result[key] = sampleValue(key, prop);
  }
  if (required?.length) {
    const ordered: Record<string, unknown> = {};
    for (const key of required) {
      if (key in result) ordered[key] = result[key];
    }
    for (const key of Object.keys(result)) {
      if (!(key in ordered)) ordered[key] = result[key];
    }
    return ordered;
  }
  return result;
}

function toolArgsFromSchema(schema?: Record<string, unknown>): string {
  if (!schema || !schema.properties) return "{}";
  const props = schema.properties as Record<string, JsonSchemaProperty>;
  const required = schema.required as string[] | undefined;
  return JSON.stringify(sampleFromProperties(props, required), null, 2);
}

/** Extract widget name from ui://widget/{name} pattern in meta */
function extractWidgetUri(meta: Record<string, unknown>): string | null {
  // Claude: meta.ui.resourceUri
  const ui = meta.ui as Record<string, unknown> | undefined;
  if (ui?.resourceUri && typeof ui.resourceUri === "string") {
    const m = (ui.resourceUri as string).match(
      /^ui:\/\/widget\/(.+?)(?:\.html)?$/
    );
    if (m) return m[1];
  }
  // Also check ui.uri (from tools/list meta)
  if (ui?.uri && typeof ui.uri === "string") {
    const m = (ui.uri as string).match(/^ui:\/\/widget\/(.+?)(?:\.html)?$/);
    if (m) return m[1];
  }
  // OpenAI: openai/outputTemplate
  const tmpl = meta["openai/outputTemplate"];
  if (typeof tmpl === "string") {
    const m = tmpl.match(/^ui:\/\/widget\/(.+?)(?:\.html)?$/);
    if (m) return m[1];
  }
  return null;
}

function formatTimestamp(): string {
  const now = new Date();
  return (
    now.toTimeString().split(" ")[0] +
    "." +
    String(now.getMilliseconds()).padStart(3, "0")
  );
}

// ── Store ──

interface StudioState {
  // Data
  widgets: WidgetInfo[];
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  loading: boolean;
  mcpError: string | null;

  // Auth
  token: string;
  tokenDraft: string;
  authOpen: boolean;

  // Selection
  selected: SelectedItem | null;

  // Editor
  editorValue: string;

  // Widget config
  platform: Platform;
  theme: string;
  locale: string;
  displayMode: string;
  viewportPreset: ViewportPreset;
  viewportCustom: ViewportSize;

  // Execution
  executing: boolean;
  jsonOutput: string | null;
  lastResult: unknown | null;
  actions: ActionEntry[];
  pendingMessages: PendingMessage[];

  // CSP / Strict mode
  strictMode: boolean;
  cspViolations: CspViolation[];

  // Iframe refs (set by component)
  _iframeRef: HTMLIFrameElement | null;
  _claudeMock: ReturnType<typeof createClaudeMock> | null;

  // Actions
  loadAll: () => Promise<void>;
  setToken: (draft: string) => void;
  saveToken: () => void;
  clearToken: () => void;
  setAuthOpen: (open: boolean) => void;
  select: (item: SelectedItem) => void;
  setEditorValue: (value: string) => void;
  setPlatform: (p: Platform) => void;
  setTheme: (t: string) => void;
  setLocale: (l: string) => void;
  setDisplayMode: (d: string) => void;
  setViewportPreset: (p: ViewportPreset) => void;
  setViewportCustom: (size: Partial<ViewportSize>) => void;
  getViewportSize: () => ViewportSize;
  logAction: (method: string, args: unknown) => void;
  clearActions: () => void;
  addPendingMessage: (source: "openai" | "claude", content: unknown) => void;
  dismissMessage: (id: string) => void;
  clearMessages: () => void;
  setIframeRef: (el: HTMLIFrameElement | null) => void;
  setStrictMode: (on: boolean) => void;
  addCspViolation: (v: CspViolation) => void;
  clearCspViolations: () => void;

  // Widget rendering
  resolveWidgetName: (responseMeta?: Record<string, unknown>) => string | null;
  renderWidget: (mock: MockData, overrideWidgetName?: string) => Promise<void>;
  loadWidget: () => Promise<void>;
  applyMock: () => void;
  resetEditor: () => void;
  execute: () => Promise<void>;
}

export const useStore = create<StudioState>((set, get) => ({
  // Data
  widgets: [],
  tools: [],
  resources: [],
  loading: true,
  mcpError: null,

  // Auth
  token: getAuthToken(),
  tokenDraft: getAuthToken(),
  authOpen: !getAuthToken(),

  // Selection
  selected: null,

  // Editor
  editorValue: defaultEditorValue(),

  // Widget config
  platform: "openai",
  theme: "dark",
  locale: "en-US",
  displayMode: "compact",
  viewportPreset: "mobile" as ViewportPreset,
  viewportCustom: { width: 430, height: 932 },

  // Execution
  executing: false,
  jsonOutput: null,
  lastResult: null,
  actions: [],
  pendingMessages: [],

  // CSP / Strict mode
  strictMode: false,
  cspViolations: [],

  // Refs
  _iframeRef: null,
  _claudeMock: null,

  // ── Actions ──

  loadAll: async () => {
    set({ loading: true, mcpError: null });

    const results = await Promise.allSettled([
      fetchWidgets(),
      listTools(),
      listResources(),
    ]);

    const w = results[0].status === "fulfilled" ? results[0].value : [];
    const t = results[1].status === "fulfilled" ? results[1].value : [];
    const r = results[2].status === "fulfilled" ? results[2].value : [];

    const mcpError =
      results[1].status === "rejected" && results[2].status === "rejected"
        ? results[1].reason?.message || "MCP request failed"
        : null;

    if (mcpError) set({ authOpen: true });

    set({
      widgets: w,
      tools: t.sort((a, b) => a.name.localeCompare(b.name)),
      resources: r.sort((a, b) =>
        (a.name || a.uri).localeCompare(b.name || b.uri)
      ),
      loading: false,
      mcpError,
    });

    // Auto-select first item
    const { selected } = get();
    if (!selected) {
      if (t.length > 0) get().select({ type: "tool", tool: t[0] });
      else if (w.length > 0) get().select({ type: "widget", name: w[0].name });
      else if (r.length > 0) get().select({ type: "resource", resource: r[0] });
    }
  },

  setToken: (draft) => set({ tokenDraft: draft }),

  saveToken: () => {
    const { tokenDraft, loadAll } = get();
    persistAuthToken(tokenDraft);
    set({ token: tokenDraft, authOpen: !tokenDraft });
    loadAll();
  },

  clearToken: () => {
    persistAuthToken("");
    set({ token: "", tokenDraft: "", authOpen: true });
    get().loadAll();
  },

  setAuthOpen: (open) => set({ authOpen: open }),

  select: (item) => {
    // Destroy previous claude mock
    get()._claudeMock?.destroy();
    set({
      selected: item,
      actions: [],
      pendingMessages: [],
      jsonOutput: null,
      lastResult: null,
      _claudeMock: null,
    });

    // Set editor value based on selection type
    if (item.type === "widget") {
      set({ editorValue: defaultEditorValue() });
    } else if (item.type === "tool") {
      set({ editorValue: toolArgsFromSchema(item.tool.inputSchema) });
    } else if (item.type === "resource") {
      set({ editorValue: JSON.stringify({ uri: item.resource.uri }, null, 2) });
    }

    // Auto-load widget if applicable (defer to let React update refs)
    const widgetName = get().resolveWidgetName();
    if (widgetName) {
      // Small delay to ensure iframe ref is set
      setTimeout(() => get().loadWidget(), 50);
    }
  },

  setEditorValue: (value) => set({ editorValue: value }),
  setPlatform: (p) => {
    set({ platform: p });
    setTimeout(() => get().loadWidget(), 50);
  },
  setTheme: (t) => {
    set({ theme: t });
    setTimeout(() => get().applyMock(), 50);
  },
  setLocale: (l) => {
    set({ locale: l });
    setTimeout(() => get().applyMock(), 50);
  },
  setDisplayMode: (d) => {
    set({ displayMode: d });
    setTimeout(() => get().applyMock(), 50);
  },
  setViewportPreset: (p) => set({ viewportPreset: p }),
  setViewportCustom: (size) => {
    set((s) => ({
      viewportCustom: { ...s.viewportCustom, ...size },
    }));
  },
  getViewportSize: () => {
    const { viewportPreset, viewportCustom } = get();
    if (viewportPreset === "custom") return viewportCustom;
    return VIEWPORT_PRESETS[viewportPreset];
  },

  logAction: (method, args) => {
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);
    set((s) => ({
      actions: [
        ...s.actions,
        { time: formatTimestamp(), method, args: argsStr },
      ],
    }));
  },

  clearActions: () => set({ actions: [] }),

  addPendingMessage: (source, content) => {
    const msg: PendingMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: formatTimestamp(),
      source,
      content,
    };
    set((s) => ({ pendingMessages: [...s.pendingMessages, msg] }));
  },

  dismissMessage: (id) => {
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((m) => m.id !== id),
    }));
  },

  clearMessages: () => set({ pendingMessages: [] }),

  setIframeRef: (el) => set({ _iframeRef: el }),

  setStrictMode: (on) => {
    set({ strictMode: on, cspViolations: [] });
    setTimeout(() => get().loadWidget(), 50);
  },

  addCspViolation: (v) => {
    set((s) => {
      // Deduplicate by directive + blockedUri
      const isDupe = s.cspViolations.some(
        (existing) =>
          existing.directive === v.directive &&
          existing.blockedUri === v.blockedUri
      );
      if (isDupe) return s;
      return { cspViolations: [...s.cspViolations, v] };
    });
  },

  clearCspViolations: () => set({ cspViolations: [] }),

  // ── Widget name resolution ──

  resolveWidgetName: (responseMeta) => {
    // 1. Check response meta (from tools/call result)
    if (responseMeta) {
      const fromResponse = extractWidgetUri(responseMeta);
      if (fromResponse) return fromResponse;
    }

    const { selected, widgets } = get();
    if (!selected) return null;

    // 2. Widget selection → direct name
    if (selected.type === "widget") return selected.name;

    // 3. Resource → parse URI
    if (selected.type === "resource") {
      const m = selected.resource.uri.match(
        /^ui:\/\/widget\/(.+?)(?:\.html)?$/
      );
      return m ? m[1] : null;
    }

    // 4. Tool → check meta, then fuzzy match against known widgets
    if (selected.type === "tool") {
      const meta = selected.tool.meta;
      if (meta) {
        const fromMeta = extractWidgetUri(meta);
        if (fromMeta) return fromMeta;
      }

      // Fuzzy match against widget names
      const knownNames = widgets.map((w) => w.name);
      const toolName = selected.tool.name;

      if (knownNames.includes(toolName)) return toolName;

      for (const w of knownNames) {
        if (toolName.includes(w) || w.includes(toolName)) return w;
        const stripped = toolName.replace(
          /^(create|get|list|update|add|delete|remove|submit|review)_/,
          ""
        );
        if (w === stripped || w.includes(stripped) || stripped.includes(w))
          return w;
      }
    }

    return null;
  },

  // ── Widget rendering ──

  renderWidget: async (mock, overrideWidgetName) => {
    const {
      _iframeRef: iframe,
      platform,
      strictMode,
      logAction,
      addCspViolation,
    } = get();
    const name = overrideWidgetName || get().resolveWidgetName();
    if (!name || !iframe) return;

    // Reset inline height from previous render so auto-resize starts fresh
    iframe.style.height = "";

    // Cleanup previous claude mock
    get()._claudeMock?.destroy();
    set({ _claudeMock: null, cspViolations: [] });

    // Both platforms embed HTML via srcdoc (not iframe.src), matching how
    // ChatGPT and Claude actually host widgets in production.
    const resp = await fetch(getRawWidgetUrl(name));
    let html = await resp.text();

    // The backend rewrites asset URLs to the tunnel domain (e.g. https://xxx.tunnel.mcpr.app/assets/...).
    // For srcdoc, the iframe origin is localhost, so those cross-origin requests fail (CORS).
    // Rewrite them back to the local proxy which can serve the same assets without CORS issues.
    const baseUrl = getBaseUrl();
    // Strip tunnel/proxy URLs back to relative paths for static analysis.
    // This restores the original paths (e.g. "/assets/main.js") so the analyzer
    // sees what the developer actually wrote, not the rewritten URLs.
    const originalHtml = html.replace(
      /https?:\/\/[a-z0-9]+\.tunnel\.mcpr\.app/gi,
      ""
    );
    html = html.replace(/https?:\/\/[a-z0-9]+\.tunnel\.mcpr\.app/gi, baseUrl);

    // Extract CSP domains from mock metadata
    const meta = (mock._meta || {}) as Record<string, unknown>;
    const cspDomains = extractCspDomains(meta);

    // Run static analysis on the original HTML (with tunnel URLs stripped to
    // relative paths) so violations show what the developer actually wrote.
    const widgetSource = `/widgets/${name}.html`;
    const staticIssues = analyzeHtml(originalHtml, cspDomains);
    for (const issue of staticIssues) {
      addCspViolation({
        id: `static_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: new Date().toTimeString().split(" ")[0],
        directive: issue.directive,
        blockedUri: issue.blocked,
        sourceFile: widgetSource,
        lineNumber: issue.line || 0,
        columnNumber: 0,
        source: "static",
        fix: issue.fix,
        severity: issue.severity,
        platforms: issue.platforms,
      });
    }

    // Strict mode: inject CSP meta tag and tighten sandbox
    if (strictMode) {
      const cspTag = buildCspMetaTag(platform, cspDomains);
      html = html.replace(/<head([^>]*)>/i, `<head$1>${cspTag}`);
      const profile = getProfile(platform);
      iframe.sandbox.value = profile.sandbox;

      // Inject sandbox trap for both platforms — detects access to storage,
      // geolocation, camera/mic, notifications, service workers, clipboard,
      // device APIs, and other restricted APIs at runtime
      const trap = buildSandboxTrapScript();
      html = html.replace(/<head([^>]*)>/i, `<head$1>${trap}`);

      logAction("system", `Strict mode: CSP enforced (${platform} profile)`);
    } else {
      iframe.sandbox.value =
        "allow-scripts allow-same-origin allow-popups allow-forms";
    }

    if (platform === "openai") {
      const mockScript = buildOpenAIMockScript(mock);
      const injected = html.replace(/<head([^>]*)>/i, `<head$1>${mockScript}`);
      iframe.srcdoc = injected;
    } else {
      const onToolCall = async (
        name: string,
        args: Record<string, unknown>
      ) => {
        logAction("system", `Calling tool "${name}"…`);
        return callTool(name, args);
      };
      const onMessage = (content: unknown) => {
        get().addPendingMessage("claude", content);
      };
      const claudeMock = createClaudeMock(
        iframe,
        mock,
        logAction,
        onToolCall,
        onMessage
      );
      set({ _claudeMock: claudeMock });
      iframe.srcdoc = html;
    }
  },

  loadWidget: async () => {
    const { editorValue, theme, locale, displayMode, logAction, renderWidget } =
      get();
    try {
      const parsed = JSON.parse(editorValue);
      const mock: MockData = {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };
      await renderWidget(mock);
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  applyMock: () => {
    const {
      _iframeRef: iframe,
      platform,
      editorValue,
      theme,
      locale,
      displayMode,
      logAction,
      renderWidget,
      resolveWidgetName,
    } = get();
    if (!resolveWidgetName()) return;

    try {
      const parsed = JSON.parse(editorValue);
      const mock: MockData = {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };

      // Try hot-update first
      if (platform === "openai" && iframe) {
        try {
          const win = iframe.contentWindow;
          if (win && (win as unknown as { openai: unknown }).openai) {
            const openai = (
              win as unknown as { openai: Record<string, unknown> }
            ).openai;
            openai.toolInput = mock.toolInput;
            openai.toolOutput = mock.toolOutput;
            openai.toolResponseMetadata = mock._meta;
            openai.widgetState = mock.widgetState;
            openai.theme = mock.theme;
            openai.locale = mock.locale;
            openai.displayMode = mock.displayMode;
            win.dispatchEvent(new CustomEvent("openai:set_globals"));
            logAction("system", "Mock data applied");
            return;
          }
        } catch {
          /* fall through to full reload */
        }
      }

      if (platform === "claude") {
        get()._claudeMock?.update(mock);
        logAction("system", "Mock data applied");
        return;
      }

      // Full reload fallback
      renderWidget(mock);
      logAction("system", "Mock data applied (reload)");
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  resetEditor: () => {
    const { selected, loadWidget } = get();
    if (!selected) return;
    if (selected.type === "widget") {
      set({ editorValue: defaultEditorValue() });
    } else if (selected.type === "tool") {
      set({ editorValue: toolArgsFromSchema(selected.tool.inputSchema) });
    } else if (selected.type === "resource") {
      set({
        editorValue: JSON.stringify({ uri: selected.resource.uri }, null, 2),
      });
    }
    setTimeout(loadWidget, 50);
  },

  // ── Execute ──

  execute: async () => {
    const {
      selected,
      editorValue,
      theme,
      locale,
      displayMode,
      logAction,
      renderWidget,
      resolveWidgetName,
    } = get();
    if (!selected) return;
    set({ executing: true });
    logAction("system", `Executing ${selected.type}…`);

    try {
      let result: unknown;

      if (selected.type === "tool") {
        const args = JSON.parse(editorValue);
        result = await callTool(selected.tool.name, args);
        logAction("tools/call", { name: selected.tool.name, result });
      } else if (selected.type === "resource") {
        result = await readResource(selected.resource.uri);
        logAction("resources/read", { uri: selected.resource.uri, result });
      } else {
        set({ executing: false });
        return;
      }

      // Extract tool output
      const content = result as {
        content?: Array<{ type: string; text?: string }>;
        meta?: Record<string, unknown>;
      };
      let toolOutput: unknown = result;
      const meta = content.meta || {};

      if (content.content) {
        const textContent = content.content.find((c) => c.type === "text");
        if (textContent?.text) {
          try {
            toolOutput = JSON.parse(textContent.text);
          } catch {
            toolOutput = textContent.text;
          }
        }
      }

      const toolInput = selected.type === "tool" ? JSON.parse(editorValue) : {};
      const mockData = {
        toolInput,
        toolOutput,
        _meta: meta,
        widgetState: null,
      };

      // Store result separately — don't overwrite editor
      set({ lastResult: result });

      // Resolve widget from response meta
      const widgetName = resolveWidgetName(meta);

      if (widgetName) {
        set({ jsonOutput: null });
        const mock: MockData = { ...mockData, theme, locale, displayMode };
        await renderWidget(mock, widgetName);
        logAction(
          "system",
          `Widget "${widgetName}" rendered with real tool response`
        );
      } else {
        set({ jsonOutput: JSON.stringify(result, null, 2) });
        logAction("system", "No widget — showing JSON response");
      }
    } catch (e) {
      logAction("error", (e as Error).message);
    } finally {
      set({ executing: false });
    }
  },
}));
