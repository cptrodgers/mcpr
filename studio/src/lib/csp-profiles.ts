/**
 * CSP profile definitions for ChatGPT and Claude widget sandboxes.
 *
 * When strict mode is ON, we inject a <meta http-equiv="Content-Security-Policy">
 * tag into the widget HTML that mirrors what the real platform enforces.
 * If a widget works under strict mode it will work in production.
 */

export interface CspProfile {
  name: string;
  /** Build a full CSP header string given the widget's declared domains. */
  build(domains: CspDomains): string;
  /** Sandbox attribute value for the iframe. */
  sandbox: string;
}

export interface CspDomains {
  connectDomains: string[];
  resourceDomains: string[];
}

/** Shared helper — dedup and join domains for a directive. */
function dirs(base: string[], extra: string[]): string {
  const all = [...new Set([...base, ...extra])];
  return all.length > 0 ? " " + all.join(" ") : "";
}

/**
 * ChatGPT CSP profile.
 *
 * OpenAI hosts widgets in a sandboxed iframe with a restrictive CSP.
 * - No eval, no dynamic script loading from arbitrary origins
 * - connect-src restricted to declared connect_domains
 * - img/font/style/media restricted to declared resource_domains
 * - Inline scripts and styles are allowed (srcdoc requires it)
 */
export const chatgptProfile: CspProfile = {
  name: "ChatGPT",
  sandbox: "allow-scripts allow-popups allow-forms",
  build({ connectDomains, resourceDomains }: CspDomains): string {
    const connect = dirs(connectDomains, []);
    const resource = dirs(resourceDomains, []);
    return [
      "default-src 'none'",
      `script-src 'unsafe-inline'${resource}`,
      `style-src 'unsafe-inline'${resource}`,
      `img-src data: blob:${resource}`,
      `font-src data:${resource}`,
      `connect-src${connect}`,
      `media-src blob:${resource}`,
      "worker-src blob:",
      "child-src blob:",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  },
};

/**
 * Claude CSP profile.
 *
 * Claude hosts MCP Apps in a sandboxed iframe with CSP.
 * Similar to ChatGPT but allows same-origin for JSON-RPC postMessage.
 */
export const claudeProfile: CspProfile = {
  name: "Claude",
  sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
  build({ connectDomains, resourceDomains }: CspDomains): string {
    const connect = dirs(connectDomains, []);
    const resource = dirs(resourceDomains, []);
    return [
      "default-src 'none'",
      `script-src 'unsafe-inline'${resource}`,
      `style-src 'unsafe-inline'${resource}`,
      `img-src data: blob:${resource}`,
      `font-src data:${resource}`,
      `connect-src${connect}`,
      `media-src blob:${resource}`,
      "worker-src blob:",
      "child-src blob:",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  },
};

export function getProfile(platform: "openai" | "claude"): CspProfile {
  return platform === "openai" ? chatgptProfile : claudeProfile;
}

/**
 * Extract CSP domains from widget metadata (supports both OpenAI and Claude formats).
 */
export function extractCspDomains(meta: Record<string, unknown>): CspDomains {
  const result: CspDomains = { connectDomains: [], resourceDomains: [] };

  // OpenAI format: meta["openai/widgetCSP"].connect_domains / resource_domains
  const widgetCSP = meta["openai/widgetCSP"] as
    | Record<string, unknown>
    | undefined;
  if (widgetCSP) {
    if (Array.isArray(widgetCSP.connect_domains)) {
      result.connectDomains.push(
        ...widgetCSP.connect_domains.filter(
          (d): d is string => typeof d === "string"
        )
      );
    }
    if (Array.isArray(widgetCSP.resource_domains)) {
      result.resourceDomains.push(
        ...widgetCSP.resource_domains.filter(
          (d): d is string => typeof d === "string"
        )
      );
    }
  }

  // Claude format: meta.ui.csp.connectDomains / resourceDomains
  const ui = meta.ui as Record<string, unknown> | undefined;
  const csp = ui?.csp as Record<string, unknown> | undefined;
  if (csp) {
    if (Array.isArray(csp.connectDomains)) {
      result.connectDomains.push(
        ...csp.connectDomains.filter((d): d is string => typeof d === "string")
      );
    }
    if (Array.isArray(csp.resourceDomains)) {
      result.resourceDomains.push(
        ...csp.resourceDomains.filter((d): d is string => typeof d === "string")
      );
    }
  }

  // Deduplicate
  result.connectDomains = [...new Set(result.connectDomains)];
  result.resourceDomains = [...new Set(result.resourceDomains)];

  return result;
}

/**
 * Build CSP meta tag HTML string for injection into widget <head>.
 */
export function buildCspMetaTag(
  platform: "openai" | "claude",
  domains: CspDomains
): string {
  const profile = getProfile(platform);
  const csp = profile.build(domains);
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
}

/**
 * Build a full CSP string (without the meta tag wrapper).
 */
export function buildCspString(
  platform: "openai" | "claude",
  domains: CspDomains
): string {
  return getProfile(platform).build(domains);
}

/**
 * Build a <script> that traps restricted API access at runtime.
 *
 * Sandboxed widget iframes should not access storage, geolocation,
 * camera/mic, notifications, service workers, clipboard, credentials,
 * bluetooth, USB, or other device/permission APIs. Neither ChatGPT nor
 * Claude grant these permissions to widgets.
 *
 * Without allow-same-origin (ChatGPT) storage APIs throw SecurityError.
 * Even with allow-same-origin (Claude) these APIs are not intended for
 * widget use — the platforms could revoke access at any time.
 *
 * This script intercepts access attempts and reports them via postMessage
 * so the studio can surface them in the CSP Check panel — even when the
 * code lives in bundled JS that static analysis can't inspect.
 *
 * Injected in strict mode for both platforms.
 */
export function buildSandboxTrapScript(): string {
  return `<script>
(function() {
  var reported = {};
  function report(label, category, err, severity) {
    var key = label + ':' + (severity || 'error');
    if (reported[key]) return;
    reported[key] = true;
    window.parent.postMessage({
      type: 'mcpr_sandbox_violation',
      api: label,
      category: category,
      severity: severity || 'error',
      message: err ? err.message : label + ' is not available in widget sandboxed iframe'
    }, '*');
  }

  // --- Storage APIs (SecurityError without allow-same-origin) ---
  var storageProps = [
    { prop: 'localStorage', label: 'localStorage' },
    { prop: 'sessionStorage', label: 'sessionStorage' },
    { prop: 'indexedDB', label: 'indexedDB' },
    { prop: 'caches', label: 'Cache API (caches)' },
  ];
  storageProps.forEach(function(api) {
    try {
      var desc = Object.getOwnPropertyDescriptor(window, api.prop);
      if (desc && desc.get) {
        var origGet = desc.get;
        Object.defineProperty(window, api.prop, {
          get: function() {
            try { var v = origGet.call(this); report(api.label, 'storage', null, 'warning'); return v; }
            catch(e) { report(api.label, 'storage', e, 'error'); throw e; }
          },
          configurable: true
        });
      }
    } catch(e) {}
  });

  // Trap document.cookie
  try {
    var cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
      || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
    if (cookieDesc) {
      var origCGet = cookieDesc.get;
      var origCSet = cookieDesc.set;
      Object.defineProperty(document, 'cookie', {
        get: function() {
          try { var v = origCGet.call(this); report('document.cookie', 'storage', null, 'warning'); return v; }
          catch(e) { report('document.cookie', 'storage', e, 'error'); throw e; }
        },
        set: function(v) {
          try { origCSet.call(this, v); report('document.cookie (set)', 'storage', null, 'error'); }
          catch(e) { report('document.cookie (set)', 'storage', e, 'error'); throw e; }
        },
        configurable: true
      });
    }
  } catch(e) {}

  // --- Navigator APIs (permissions / device access) ---
  // Getter (property read)  -> warning  (code touched it, be aware)
  // Setter / method call    -> error    (this will fail in production)

  // Trap a method call on an object -> error
  function trapMethod(obj, prop, label, category) {
    try {
      if (typeof obj[prop] !== 'function') return;
      var orig = obj[prop].bind(obj);
      obj[prop] = function() {
        report(label, category, null, 'error');
        return orig.apply(null, arguments);
      };
    } catch(e) {}
  }

  // Trap property getter on navigator -> warning
  function trapNavGetter(prop, label, category) {
    try {
      var desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop)
        || Object.getOwnPropertyDescriptor(navigator, prop);
      if (!desc) return;
      if (desc.get) {
        var origGet = desc.get;
        Object.defineProperty(navigator, prop, {
          get: function() { report(label, category, null, 'warning'); return origGet.call(this); },
          configurable: true
        });
      } else if (desc.value !== undefined) {
        var origVal = desc.value;
        Object.defineProperty(navigator, prop, {
          get: function() { report(label, category, null, 'warning'); return origVal; },
          configurable: true
        });
      }
    } catch(e) {}
  }

  // Trap getter + all methods on a navigator sub-object.
  // Getter = warning, method calls = error.
  // Important: grab the object reference BEFORE installing the getter trap,
  // otherwise our own read triggers the warning.
  function trapSubApi(parentProp, getterLabel, methods, category) {
    try {
      // Read the object FIRST (before getter trap is installed)
      var obj = navigator[parentProp];
      if (obj) {
        methods.forEach(function(m) {
          trapMethod(obj, m.method, m.label, category);
        });
      }
    } catch(e) {}
    // Now install the getter trap
    trapNavGetter(parentProp, getterLabel, category);
  }

  // Geolocation
  trapSubApi('geolocation', 'navigator.geolocation', [
    { method: 'getCurrentPosition', label: 'geolocation.getCurrentPosition()' },
    { method: 'watchPosition', label: 'geolocation.watchPosition()' },
  ], 'permission');

  // Camera / Microphone
  trapSubApi('mediaDevices', 'navigator.mediaDevices', [
    { method: 'getUserMedia', label: 'mediaDevices.getUserMedia()' },
    { method: 'getDisplayMedia', label: 'mediaDevices.getDisplayMedia()' },
    { method: 'enumerateDevices', label: 'mediaDevices.enumerateDevices()' },
  ], 'permission');

  // Notifications — constructor = error, requestPermission = error, .permission getter = warning
  if (typeof Notification !== 'undefined') {
    var OrigNotif = Notification;
    window.Notification = function() {
      report('new Notification()', 'permission', null, 'error');
      return new OrigNotif(arguments[0], arguments[1]);
    };
    window.Notification.prototype = OrigNotif.prototype;
    Object.defineProperty(window.Notification, 'permission', {
      get: function() { report('Notification.permission', 'permission', null, 'warning'); return OrigNotif.permission; }
    });
    window.Notification.requestPermission = function() {
      report('Notification.requestPermission()', 'permission', null, 'error');
      return OrigNotif.requestPermission.apply(OrigNotif, arguments);
    };
  }

  // Service Worker
  trapSubApi('serviceWorker', 'navigator.serviceWorker', [
    { method: 'register', label: 'serviceWorker.register()' },
    { method: 'getRegistrations', label: 'serviceWorker.getRegistrations()' },
  ], 'worker');

  // Clipboard
  trapSubApi('clipboard', 'navigator.clipboard', [
    { method: 'readText', label: 'clipboard.readText()' },
    { method: 'writeText', label: 'clipboard.writeText()' },
    { method: 'read', label: 'clipboard.read()' },
    { method: 'write', label: 'clipboard.write()' },
  ], 'permission');

  // Credentials
  trapSubApi('credentials', 'navigator.credentials', [
    { method: 'get', label: 'credentials.get()' },
    { method: 'create', label: 'credentials.create()' },
    { method: 'store', label: 'credentials.store()' },
  ], 'permission');

  // Bluetooth
  trapSubApi('bluetooth', 'navigator.bluetooth', [
    { method: 'requestDevice', label: 'bluetooth.requestDevice()' },
    { method: 'getAvailability', label: 'bluetooth.getAvailability()' },
  ], 'device');

  // USB
  trapSubApi('usb', 'navigator.usb', [
    { method: 'requestDevice', label: 'usb.requestDevice()' },
    { method: 'getDevices', label: 'usb.getDevices()' },
  ], 'device');

  // Serial
  trapSubApi('serial', 'navigator.serial', [
    { method: 'requestPort', label: 'serial.requestPort()' },
    { method: 'getPorts', label: 'serial.getPorts()' },
  ], 'device');

  // HID
  trapSubApi('hid', 'navigator.hid', [
    { method: 'requestDevice', label: 'hid.requestDevice()' },
    { method: 'getDevices', label: 'hid.getDevices()' },
  ], 'device');

  // Web Share — method calls = error
  trapMethod(navigator, 'share', 'navigator.share()', 'permission');
  trapMethod(navigator, 'canShare', 'navigator.canShare()', 'permission');

  // Payment Request — constructor = error
  if (typeof PaymentRequest !== 'undefined') {
    var OrigPR = PaymentRequest;
    window.PaymentRequest = function() {
      report('new PaymentRequest()', 'permission', null, 'error');
      return new OrigPR(arguments[0], arguments[1], arguments[2]);
    };
    window.PaymentRequest.prototype = OrigPR.prototype;
  }

  // window.open — warning (sandbox allow-popups may permit it)
  var origOpen = window.open;
  window.open = function() {
    report('window.open()', 'navigation', null, 'warning');
    return origOpen.apply(window, arguments);
  };

  // document.domain — getter = warning, setter = error
  try {
    var domainDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'domain');
    if (domainDesc && domainDesc.set) {
      var origDomainGet = domainDesc.get;
      var origDomainSet = domainDesc.set;
      Object.defineProperty(document, 'domain', {
        get: function() { report('document.domain', 'navigation', null, 'warning'); return origDomainGet.call(this); },
        set: function(v) {
          report('document.domain (set)', 'navigation', null, 'error');
          return origDomainSet.call(this, v);
        },
        configurable: true
      });
    }
  } catch(e) {}
})();
</script>`;
}
