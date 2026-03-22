/**
 * Generates a <script> block that creates a mock `window.openai` object.
 * This is injected into the widget iframe HTML before any widget JS runs.
 */
export function buildOpenAIMockScript(mock: MockData): string {
  return `<script>
window.openai = {
  toolInput: ${JSON.stringify(mock.toolInput)},
  toolOutput: ${JSON.stringify(mock.toolOutput)},
  toolResponseMetadata: ${JSON.stringify(mock._meta)},
  widgetState: ${JSON.stringify(mock.widgetState)},
  theme: '${mock.theme}',
  locale: '${mock.locale}',
  displayMode: '${mock.displayMode}',
  maxHeight: window.innerHeight,
  safeArea: { top: 0, bottom: 0, left: 0, right: 0 },

  sendFollowUpMessage: function(opts) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'sendFollowUpMessage', args: opts }, '*');
    return Promise.resolve();
  },
  callTool: function(name, args) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'callTool', args: { name: name, arguments: args } }, '*');
    return new Promise(function(resolve) {
      window.__mcpr_pending_tool = resolve;
    });
  },
  setWidgetState: function(state) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'setWidgetState', args: state }, '*');
  },
  openExternal: function(opts) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'openExternal', args: opts }, '*');
    return Promise.resolve();
  },
  notifyIntrinsicHeight: function(h) {
    window.parent.postMessage({ type: 'mcpr_resize', height: h }, '*');
  },
  requestDisplayMode: function() {
    window.parent.postMessage({ type: 'mcpr_action', method: 'requestDisplayMode', args: Array.from(arguments) }, '*');
    return Promise.resolve();
  },
  requestClose: function() {
    window.parent.postMessage({ type: 'mcpr_action', method: 'requestClose', args: {} }, '*');
  },
  requestModal: function(opts) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'requestModal', args: opts }, '*');
    return Promise.resolve();
  },
  uploadFile: function(file) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'uploadFile', args: { name: file.name, size: file.size } }, '*');
    return Promise.resolve({ fileId: 'mock-file-' + Date.now() });
  },
  getFileDownloadUrl: function(opts) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'getFileDownloadUrl', args: opts }, '*');
    return Promise.resolve({ url: 'https://example.com/mock-download' });
  },
  setOpenInAppUrl: function(opts) {
    window.parent.postMessage({ type: 'mcpr_action', method: 'setOpenInAppUrl', args: opts }, '*');
  }
};
<\/script>`;
}

export interface MockData {
  toolInput: unknown;
  toolOutput: unknown;
  _meta: Record<string, unknown>;
  widgetState: unknown;
  theme: string;
  locale: string;
  displayMode: string;
}

export const DEFAULT_MOCK: MockData = {
  toolInput: {},
  toolOutput: { message: "Replace with your widget's tool output data" },
  _meta: {},
  widgetState: null,
  theme: "dark",
  locale: "en-US",
  displayMode: "compact",
};
