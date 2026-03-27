import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  RouterProvider,
  createRouter,
  createHashHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routes";
import "./index.css";

// ── OAuth callback interception ──
// The OAuth server redirects to /studio/oauth/callback?code=...&state=...
// Since we use hash routing, that URL just loads the Studio SPA. We detect
// the callback params here (before React mounts) and relay them to the
// opener window via postMessage.

function handleOAuthCallbackIfNeeded(): boolean {
  const path = window.location.pathname;
  if (!path.endsWith("/oauth/callback")) return false;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  const root = document.getElementById("root")!;

  if (error) {
    // Relay error to opener
    const msg = errorDescription || error;
    if (window.opener) {
      try {
        window.opener.postMessage(
          { type: "mcpr_oauth_callback", error: msg },
          window.location.origin
        );
      } catch {
        /* cross-origin */
      }
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888">
          <div style="text-align:center">
            <p style="color:#e55">Sign in failed: ${msg}</p>
            <p style="font-size:13px;margin-top:8px">This window will close automatically.</p>
          </div>
        </div>`;
      setTimeout(() => window.close(), 1500);
    } else {
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888">
          <div style="text-align:center">
            <p style="color:#e55">Sign in failed: ${msg}</p>
            <p style="font-size:13px;margin-top:8px"><a href="/studio/">Back to Studio</a></p>
          </div>
        </div>`;
    }
    return true;
  }

  if (code && state) {
    if (window.opener) {
      try {
        window.opener.postMessage(
          { type: "mcpr_oauth_callback", code, state },
          window.location.origin
        );
      } catch {
        /* cross-origin */
      }
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888">
          <div style="text-align:center">
            <p style="color:#4a4">Authorization received</p>
            <p style="font-size:13px;margin-top:8px">This window will close automatically.</p>
          </div>
        </div>`;
      setTimeout(() => window.close(), 800);
    } else {
      // No opener — user navigated here directly, or popup blocker
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888">
          <div style="text-align:center">
            <p style="color:#4a4">Authorization received</p>
            <p style="font-size:13px;margin-top:8px">Return to Studio to complete sign in.</p>
            <p style="font-size:13px;margin-top:4px"><a href="/studio/">Back to Studio</a></p>
          </div>
        </div>`;
    }
    return true;
  }

  return false;
}

const hashHistory = createHashHistory();
const router = createRouter({ routeTree, history: hashHistory });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// If this is an OAuth callback, handle it and stop — don't mount the full app
if (!handleOAuthCallbackIfNeeded()) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
