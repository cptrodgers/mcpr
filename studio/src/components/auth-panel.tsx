import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

function formatTimeRemaining(expiresAt: number | null): string {
  if (!expiresAt) return "";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((diff % 60_000) / 1_000);
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const STATUS_LABELS: Record<string, string> = {
  idle: "Not connected",
  discovering: "Discovering...",
  registering: "Registering...",
  authorizing: "Awaiting auth...",
  exchanging: "Exchanging token...",
  connected: "Connected",
  error: "Error",
};

export function AuthPanel() {
  const {
    authMethod,
    token,
    tokenDraft,
    authOpen,
    mcpError,
    oauth,
    setAuthMethod,
    setToken,
    saveToken,
    clearToken,
    setAuthOpen,
    startOAuthFlow,
    signOut,
    setOAuthClientId,
    setOAuthClientSecret,
    setOAuthRedirectUri,
    setOAuthSelectedScopes,
    setOAuthDebugOpen,
  } = useStore();

  const [timeRemaining, setTimeRemaining] = useState("");
  const [copiedUri, setCopiedUri] = useState(false);

  // Listen for OAuth popup callback
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== "mcpr_oauth_callback") return;

      const store = useStore.getState();

      if (e.data.error) {
        useStore.setState((s) => ({
          oauth: { ...s.oauth, status: "error", error: e.data.error },
        }));
        return;
      }

      if (e.data.code && e.data.state) {
        store.handleOAuthCallback(e.data.code, e.data.state);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Update time remaining every second when connected
  useEffect(() => {
    if (oauth.status !== "connected" || !oauth.expiresAt) return;
    const update = () => setTimeRemaining(formatTimeRemaining(oauth.expiresAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [oauth.status, oauth.expiresAt]);

  const hasToken =
    authMethod === "bearer" ? token.length > 0 : oauth.status === "connected";
  const isOAuthBusy = [
    "discovering",
    "registering",
    "authorizing",
    "exchanging",
  ].includes(oauth.status);

  const redirectUri =
    oauth.redirectUri || `${window.location.origin}/studio/oauth/callback`;

  const copyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 1500);
  };

  return (
    <div className="border-b shrink-0">
      <button
        onClick={() => setAuthOpen(!authOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-secondary/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          Auth
          {hasToken && !authOpen && (
            <span className="text-green-500 normal-case font-normal text-[10px]">
              {authMethod === "oauth" ? "OAuth" : "Bearer"}
            </span>
          )}
          {mcpError && !hasToken && !authOpen && (
            <span className="text-destructive normal-case font-normal">
              401
            </span>
          )}
        </span>
        <span className="text-[8px]">{authOpen ? "▲" : "▼"}</span>
      </button>

      {authOpen && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* Method selector */}
          <div className="flex gap-1 rounded-lg bg-secondary/50 p-1">
            <button
              onClick={() => setAuthMethod("oauth")}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                authMethod === "oauth"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              OAuth 2.1
            </button>
            <button
              onClick={() => setAuthMethod("bearer")}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                authMethod === "bearer"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Bearer Token
            </button>
          </div>

          {/* Callback URI — always visible in OAuth mode */}
          {authMethod === "oauth" && (
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-muted-foreground shrink-0">Callback:</span>
              <code
                className="text-muted-foreground/70 font-mono truncate cursor-pointer hover:text-foreground transition-colors"
                title={redirectUri}
                onClick={copyRedirectUri}
              >
                {redirectUri}
              </code>
              <button
                onClick={copyRedirectUri}
                className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              >
                {copiedUri ? "Copied!" : "Copy"}
              </button>
            </div>
          )}

          {authMethod === "bearer" ? (
            /* ── Bearer Token ── */
            <div>
              <div className="flex gap-1">
                <input
                  type="password"
                  placeholder="Paste token..."
                  value={tokenDraft}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveToken()}
                  className="flex-1 min-w-0 bg-secondary text-secondary-foreground rounded-md px-2 py-1.5 text-xs border-0 font-mono"
                />
                {token.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2 shrink-0"
                    onClick={clearToken}
                  >
                    Clear
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 text-xs px-3 shrink-0"
                    onClick={saveToken}
                  >
                    Set
                  </Button>
                )}
              </div>
              {mcpError && !token && (
                <p className="text-[10px] text-destructive mt-1">
                  401 — token required
                </p>
              )}
              {token.length > 0 && (
                <p className="text-[10px] text-green-500 mt-1">connected</p>
              )}
            </div>
          ) : (
            /* ── OAuth 2.1 ── */
            <div className="space-y-2">
              {oauth.status === "connected" ? (
                /* Connected */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      <span className="text-xs text-green-500 font-medium">
                        Authenticated
                      </span>
                    </div>
                    {oauth.expiresAt && (
                      <span
                        className={`text-[10px] font-mono ${
                          timeRemaining === "expired"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {timeRemaining}
                      </span>
                    )}
                  </div>

                  {oauth.decodedToken?.scopes && (
                    <div className="flex flex-wrap gap-1">
                      {oauth.decodedToken.scopes.map((s) => (
                        <span
                          key={s}
                          className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 text-[10px]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={signOut}
                  >
                    Sign Out
                  </Button>
                </div>
              ) : oauth.status === "error" ? (
                /* Error */
                <div className="space-y-2">
                  <div className="bg-destructive/10 rounded-md px-2.5 py-2">
                    <p className="text-[11px] text-destructive break-words">
                      {oauth.error}
                    </p>
                  </div>

                  {oauth.error?.includes("client_id") && (
                    <input
                      type="text"
                      placeholder="Enter client_id"
                      value={oauth.clientId}
                      onChange={(e) => setOAuthClientId(e.target.value)}
                      className="w-full bg-secondary text-secondary-foreground rounded-md px-2 py-1.5 text-xs border-0 font-mono"
                    />
                  )}

                  <Button
                    size="sm"
                    className="h-7 text-xs px-3"
                    onClick={() => {
                      setOAuthDebugOpen(true);
                      startOAuthFlow();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : isOAuthBusy ? (
                /* In-progress */
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-yellow-500">
                    {STATUS_LABELS[oauth.status]}
                  </span>
                </div>
              ) : (
                /* Idle — ready to sign in */
                <div className="space-y-2">
                  {/* Client ID */}
                  <input
                    type="text"
                    placeholder="OAuth Client ID (optional)"
                    value={oauth.clientId}
                    onChange={(e) => setOAuthClientId(e.target.value)}
                    className="w-full bg-secondary text-secondary-foreground rounded-md px-2.5 py-2 text-xs border-0 font-mono placeholder:text-muted-foreground/50"
                  />

                  {/* Client Secret */}
                  <input
                    type="password"
                    placeholder="OAuth Client Secret (optional)"
                    value={oauth.clientSecret}
                    onChange={(e) => setOAuthClientSecret(e.target.value)}
                    className="w-full bg-secondary text-secondary-foreground rounded-md px-2.5 py-2 text-xs border-0 font-mono placeholder:text-muted-foreground/50"
                  />

                  {/* Redirect URI override */}
                  <input
                    type="text"
                    placeholder={`Redirect URI (${window.location.origin}/studio/oauth/callback)`}
                    value={oauth.redirectUri}
                    onChange={(e) => setOAuthRedirectUri(e.target.value)}
                    className="w-full bg-secondary text-secondary-foreground rounded-md px-2.5 py-2 text-xs border-0 font-mono placeholder:text-muted-foreground/50"
                  />

                  {/* Scopes */}
                  {oauth.scopes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {oauth.scopes.map((scope) => {
                        const sel = oauth.selectedScopes.includes(scope);
                        return (
                          <button
                            key={scope}
                            onClick={() => {
                              const next = sel
                                ? oauth.selectedScopes.filter(
                                    (s) => s !== scope
                                  )
                                : [...oauth.selectedScopes, scope];
                              setOAuthSelectedScopes(next);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                              sel
                                ? "bg-primary/20 border-primary text-primary"
                                : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {scope}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Sign In */}
                  <Button
                    size="sm"
                    className="h-8 text-xs px-4 w-full"
                    onClick={() => {
                      setOAuthDebugOpen(true);
                      startOAuthFlow();
                    }}
                  >
                    Sign In with OAuth
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
