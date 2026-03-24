/**
 * Static analysis scanner for common CSP violations in widget HTML.
 *
 * Runs before rendering to catch issues that would be blocked by
 * ChatGPT/Claude CSP policies. Each check returns actionable fix suggestions.
 */

import type { CspDomains } from "./csp-profiles";

export interface CspIssue {
  severity: "error" | "warning";
  /** Which directive would block this */
  directive: string;
  /** What was detected */
  description: string;
  /** The problematic URL or code snippet */
  blocked: string;
  /** How to fix it */
  fix: string;
  /** Affects which platforms */
  platforms: ("ChatGPT" | "Claude")[];
  /** Source line number (approximate, 1-based) */
  line?: number;
}

/** Extract the origin (scheme + host) from a URL string. */
function extractOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

/** Check if a URL origin is in the allowed domains list. */
function isAllowed(url: string, domains: string[]): boolean {
  const origin = extractOrigin(url);
  if (!origin) return false;
  return domains.some((d) => {
    const dOrigin = extractOrigin(d);
    return dOrigin === origin || d === origin || url.startsWith(d);
  });
}

/** Find approximate line number for a match index in source text. */
function lineOf(html: string, index: number): number {
  return html.slice(0, index).split("\n").length;
}

export function analyzeHtml(html: string, domains: CspDomains): CspIssue[] {
  const issues: CspIssue[] = [];
  const both: ("ChatGPT" | "Claude")[] = ["ChatGPT", "Claude"];

  // 1a. External script tags: <script src="https://...">
  const scriptSrcRe = /<script[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptSrcRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      issues.push({
        severity: "error",
        directive: "script-src",
        description: "External script not in resource_domains",
        blocked: url,
        fix: `Add "${extractOrigin(url)}" to resource_domains / resourceDomains in your widget CSP metadata`,
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 1b. Relative/absolute path script tags: <script src="/..."> or <script src="./...">
  // These break in sandboxed iframes because paths resolve against the sandbox origin, not your server.
  const scriptRelRe = /<script[^>]+src\s*=\s*["'](\.{0,2}\/[^"'\s>]+)/gi;
  while ((m = scriptRelRe.exec(html)) !== null) {
    const path = m[1];
    issues.push({
      severity: "error",
      directive: "script-src",
      description:
        "Relative path will not resolve in sandboxed iframe — bundle scripts inline or use absolute URLs",
      blocked: path,
      fix: "Option 1: Bundle inline using a build tool (e.g. vite-plugin-singlefile). Option 2: Serve via mcpr proxy — it auto-rewrites paths and handles CSP",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 2a. External stylesheets: <link href="https://..." rel="stylesheet">
  const linkRe = /<link[^>]+href\s*=\s*["']?(https?:\/\/[^"'\s>]+)[^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const url = m[1];
    if (
      /rel\s*=\s*["']?stylesheet/i.test(tag) &&
      !isAllowed(url, domains.resourceDomains)
    ) {
      issues.push({
        severity: "error",
        directive: "style-src",
        description: "External stylesheet not in resource_domains",
        blocked: url,
        fix: `Add "${extractOrigin(url)}" to resource_domains / resourceDomains in your widget CSP metadata`,
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 2b. Relative/absolute path stylesheets: <link href="/..." rel="stylesheet">
  const linkRelRe = /<link[^>]+href\s*=\s*["'](\.{0,2}\/[^"'\s>]+)[^>]*>/gi;
  while ((m = linkRelRe.exec(html)) !== null) {
    const tag = m[0];
    const path = m[1];
    if (/rel\s*=\s*["']?stylesheet/i.test(tag)) {
      issues.push({
        severity: "error",
        directive: "style-src",
        description:
          "Relative path will not resolve in sandboxed iframe — bundle styles inline or use absolute URLs",
        blocked: path,
        fix: "Option 1: Bundle inline using a build tool (e.g. vite-plugin-singlefile). Option 2: Serve via mcpr proxy — it auto-rewrites paths and handles CSP",
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 3. External images: <img src="https://...">
  const imgRe = /<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      issues.push({
        severity: "warning",
        directive: "img-src",
        description: "External image not in resource_domains",
        blocked: url,
        fix: `Add "${extractOrigin(url)}" to resource_domains / resourceDomains in your widget CSP metadata`,
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 4. eval() / new Function() usage
  const evalRe = /\beval\s*\(/g;
  while ((m = evalRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "script-src",
      description: "eval() is blocked — 'unsafe-eval' is not allowed",
      blocked: "eval(...)",
      fix: "Replace eval() with JSON.parse() or a safe alternative",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  const newFuncRe = /new\s+Function\s*\(/g;
  while ((m = newFuncRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "script-src",
      description: "new Function() is blocked — 'unsafe-eval' is not allowed",
      blocked: "new Function(...)",
      fix: "Rewrite to avoid dynamic code generation",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 5. fetch / XMLHttpRequest to external URLs (heuristic — look in inline scripts)
  const fetchRe =
    /(?:fetch|XMLHttpRequest)\s*\(\s*["'`](https?:\/\/[^"'`\s]+)/gi;
  while ((m = fetchRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.connectDomains)) {
      issues.push({
        severity: "error",
        directive: "connect-src",
        description: "Network request to unlisted domain",
        blocked: url,
        fix: `Add "${extractOrigin(url)}" to connect_domains / connectDomains in your widget CSP metadata`,
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 6. External fonts via @import or url() in <style> blocks
  const fontUrlRe = /url\s*\(\s*["']?(https?:\/\/[^"')\s]+)/gi;
  while ((m = fontUrlRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      issues.push({
        severity: "warning",
        directive: "font-src / style-src",
        description: "External resource URL not in resource_domains",
        blocked: url,
        fix: `Add "${extractOrigin(url)}" to resource_domains / resourceDomains in your widget CSP metadata`,
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 7. <iframe> usage (frame-src 'none' blocks this)
  const iframeRe = /<iframe[\s>]/gi;
  while ((m = iframeRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "frame-src",
      description: "Nested iframes are blocked (frame-src 'none')",
      blocked: "<iframe>",
      fix: "Remove nested iframes — render content directly in the widget",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 8. <object> / <embed> usage
  const objectRe = /<(?:object|embed)[\s>]/gi;
  while ((m = objectRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "object-src",
      description: "Plugin embeds are blocked (object-src 'none')",
      blocked: m[0].trim(),
      fix: "Remove <object>/<embed> elements",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 9. Restricted API usage — storage, permissions, device access, navigation
  //    These are blocked or unwanted in sandboxed widget iframes on both platforms.
  const restrictedApis: {
    pattern: RegExp;
    name: string;
    category: string;
    description: string;
    fix: string;
    platforms: ("ChatGPT" | "Claude")[];
    severity: "error" | "warning";
  }[] = [
    // Storage APIs (SecurityError without allow-same-origin on ChatGPT; unwanted on both)
    {
      pattern: /\blocalStorage\b/g,
      name: "localStorage",
      category: "sandbox (storage)",
      severity: "warning",
      description: "localStorage is not available in sandboxed widget iframes",
      fix: "Use window.openai.widgetState / setWidgetState() to persist state instead",
      platforms: both,
    },
    {
      pattern: /\bsessionStorage\b/g,
      name: "sessionStorage",
      category: "sandbox (storage)",
      severity: "warning",
      description:
        "sessionStorage is not available in sandboxed widget iframes",
      fix: "Use component state or widget state API instead",
      platforms: both,
    },
    {
      pattern: /\bindexedDB\b/g,
      name: "indexedDB",
      category: "sandbox (storage)",
      severity: "warning",
      description: "indexedDB is not available in sandboxed widget iframes",
      fix: "Use widget state API or pass data through tool calls instead",
      platforms: both,
    },
    {
      pattern: /\bdocument\.cookie\b/g,
      name: "document.cookie",
      category: "sandbox (storage)",
      severity: "warning",
      description:
        "document.cookie is not available in sandboxed widget iframes",
      fix: "Cookies are not available — use widget state API instead",
      platforms: both,
    },

    // Geolocation — getter = warning, method call = error
    {
      pattern: /\bnavigator\.geolocation\b(?!\s*[.=])/g,
      name: "navigator.geolocation",
      category: "sandbox (permission)",
      severity: "warning",
      description:
        "Geolocation API is not available in sandboxed widget iframes",
      fix: "Accessing navigator.geolocation will not work — pass location via tool input if needed",
      platforms: both,
    },
    {
      pattern: /\bgetCurrentPosition\s*\(/g,
      name: "getCurrentPosition()",
      category: "sandbox (permission)",
      severity: "error",
      description: "Geolocation is not available in sandboxed widget iframes",
      fix: "Remove geolocation usage — pass location data through tool input if needed",
      platforms: both,
    },
    {
      pattern: /\bwatchPosition\s*\(/g,
      name: "watchPosition()",
      category: "sandbox (permission)",
      severity: "error",
      description: "Geolocation is not available in sandboxed widget iframes",
      fix: "Remove geolocation usage",
      platforms: both,
    },

    // Camera / Microphone — getter = warning, method call = error
    {
      pattern: /\bnavigator\.mediaDevices\b(?!\s*\.)/g,
      name: "navigator.mediaDevices",
      category: "sandbox (permission)",
      severity: "warning",
      description:
        "MediaDevices API is not available in sandboxed widget iframes",
      fix: "Accessing navigator.mediaDevices will not work — widgets cannot access camera or microphone",
      platforms: both,
    },
    {
      pattern: /\bgetUserMedia\s*\(/g,
      name: "getUserMedia()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Camera/microphone access is not available in sandboxed widget iframes",
      fix: "Remove getUserMedia — widgets cannot access camera or microphone",
      platforms: both,
    },
    {
      pattern: /\bgetDisplayMedia\s*\(/g,
      name: "getDisplayMedia()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Screen capture is not available in sandboxed widget iframes",
      fix: "Remove getDisplayMedia — widgets cannot capture screen",
      platforms: both,
    },

    // Notifications — flag constructor calls and requestPermission
    {
      pattern: /\bnew\s+Notification\s*\(/g,
      name: "new Notification()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Web Notifications are not available in sandboxed widget iframes",
      fix: "Remove Notification usage — use the widget UI to display messages instead",
      platforms: both,
    },
    {
      pattern: /\bNotification\.requestPermission\s*\(/g,
      name: "Notification.requestPermission()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Notification permission requests are blocked in sandboxed iframes",
      fix: "Remove notification permission requests",
      platforms: both,
    },

    // Service Worker — flag register() call, not property read
    {
      pattern: /\.serviceWorker\.register\s*\(/g,
      name: "serviceWorker.register()",
      category: "sandbox (worker)",
      severity: "error",
      description:
        "Service Worker registration is blocked in sandboxed widget iframes",
      fix: "Remove service worker registration — widgets run in a single page context",
      platforms: both,
    },

    // Clipboard — flag actual read/write calls
    {
      pattern: /\.clipboard\.readText\s*\(/g,
      name: "clipboard.readText()",
      category: "sandbox (permission)",
      severity: "warning",
      description:
        "Clipboard read may not be available in sandboxed widget iframes",
      fix: "Wrap clipboard access in try/catch for graceful fallback",
      platforms: both,
    },
    {
      pattern: /\.clipboard\.writeText\s*\(/g,
      name: "clipboard.writeText()",
      category: "sandbox (permission)",
      severity: "warning",
      description:
        "Clipboard write may not be available in sandboxed widget iframes",
      fix: "Use document.execCommand('copy') as fallback, or wrap in try/catch",
      platforms: both,
    },

    // Credentials / WebAuthn — flag method calls
    {
      pattern: /\.credentials\.get\s*\(/g,
      name: "credentials.get()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Credential Management API is not available in sandboxed widget iframes",
      fix: "Remove credentials API — authentication should be handled by the host",
      platforms: both,
    },
    {
      pattern: /\.credentials\.create\s*\(/g,
      name: "credentials.create()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Credential Management API is not available in sandboxed widget iframes",
      fix: "Remove credentials API — authentication should be handled by the host",
      platforms: both,
    },

    // Device APIs — flag requestDevice/requestPort calls
    {
      pattern: /\.bluetooth\.requestDevice\s*\(/g,
      name: "bluetooth.requestDevice()",
      category: "sandbox (device)",
      severity: "error",
      description: "Web Bluetooth is not available in sandboxed widget iframes",
      fix: "Remove Bluetooth usage — widgets cannot access hardware devices",
      platforms: both,
    },
    {
      pattern: /\.usb\.requestDevice\s*\(/g,
      name: "usb.requestDevice()",
      category: "sandbox (device)",
      severity: "error",
      description: "WebUSB is not available in sandboxed widget iframes",
      fix: "Remove USB usage — widgets cannot access hardware devices",
      platforms: both,
    },
    {
      pattern: /\.serial\.requestPort\s*\(/g,
      name: "serial.requestPort()",
      category: "sandbox (device)",
      severity: "error",
      description: "Web Serial is not available in sandboxed widget iframes",
      fix: "Remove serial port usage — widgets cannot access hardware devices",
      platforms: both,
    },
    {
      pattern: /\.hid\.requestDevice\s*\(/g,
      name: "hid.requestDevice()",
      category: "sandbox (device)",
      severity: "error",
      description: "WebHID is not available in sandboxed widget iframes",
      fix: "Remove HID usage — widgets cannot access hardware devices",
      platforms: both,
    },

    // Payment — flag constructor
    {
      pattern: /\bnew\s+PaymentRequest\s*\(/g,
      name: "new PaymentRequest()",
      category: "sandbox (permission)",
      severity: "error",
      description:
        "Payment Request API is not available in sandboxed widget iframes",
      fix: "Remove PaymentRequest — handle payments server-side through tool calls",
      platforms: both,
    },

    // Web Share — flag method call
    {
      pattern: /\bnavigator\.share\s*\(/g,
      name: "navigator.share()",
      category: "sandbox (permission)",
      severity: "warning",
      description:
        "Web Share API may not be available in sandboxed widget iframes",
      fix: "Remove navigator.share — use openExternal() or widget UI for sharing",
      platforms: both,
    },

    // Navigation — flag setter, not reads
    {
      pattern: /\bdocument\.domain\s*=/g,
      name: "document.domain (set)",
      category: "sandbox (navigation)",
      severity: "error",
      description: "Setting document.domain is blocked in sandboxed iframes",
      fix: "Remove document.domain manipulation — use postMessage for cross-origin communication",
      platforms: both,
    },
  ];

  for (const api of restrictedApis) {
    api.pattern.lastIndex = 0;
    while ((m = api.pattern.exec(html)) !== null) {
      // Skip if inside a comment
      const ctx = html.slice(Math.max(0, m.index - 30), m.index);
      if (/\/\/\s*$/.test(ctx) || /\*\s*$/.test(ctx)) continue;

      issues.push({
        severity: api.severity,
        directive: api.category,
        description: api.description,
        blocked: api.name,
        fix: api.fix,
        platforms: api.platforms,
        line: lineOf(html, m.index),
      });
    }
  }

  return issues;
}
