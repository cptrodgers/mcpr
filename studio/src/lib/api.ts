/**
 * Get the mcpr proxy base URL.
 *
 * Priority:
 * 1. ?proxy= query param (hosted studio connecting to remote mcpr)
 * 2. In dev mode, default to localhost:3000
 * 3. Same origin (when studio is served by mcpr itself)
 */
export function getBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const proxy = params.get("proxy");
  if (proxy) {
    return proxy.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }
  return window.location.origin;
}

/** Check if studio is connected to a remote proxy (vs local) */
export function isRemoteProxy(): boolean {
  return new URLSearchParams(window.location.search).has("proxy");
}

export interface WidgetInfo {
  name: string;
  url: string;
}

export async function fetchWidgets(): Promise<WidgetInfo[]> {
  const resp = await fetch(`${getBaseUrl()}/widgets`);
  const data = await resp.json();
  return data.widgets || [];
}

export function getRawWidgetUrl(name: string): string {
  return `${getBaseUrl()}/widgets/${name}.html?raw=1`;
}
