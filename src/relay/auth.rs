use serde::Deserialize;

/// Configuration for the external auth provider.
pub struct AuthProviderConfig {
    /// Base URL of the auth provider (e.g. "https://auth.mcpr.app")
    pub url: String,
    /// Shared secret for relay ↔ auth provider trust
    pub secret: String,
    /// HTTP client for making verification requests
    pub client: reqwest::Client,
}

/// Response from the auth provider's /api/verify endpoint.
#[derive(Deserialize)]
struct AuthVerifyResponse {
    subdomains: Vec<String>,
}

/// Error response from the auth provider.
#[derive(Deserialize)]
struct AuthErrorResponse {
    error: String,
}

pub enum AuthError {
    InvalidToken(String),
    ProviderUnavailable(String),
}

/// Call the auth provider to verify a token and get allowed subdomains.
pub async fn verify_token(
    auth: &AuthProviderConfig,
    token: &str,
    subdomain: &str,
) -> Result<Vec<String>, AuthError> {
    let resp = auth
        .client
        .post(format!("{}/api/verify", auth.url))
        .header("X-Relay-Secret", &auth.secret)
        .json(&serde_json::json!({
            "token": token,
            "subdomain": subdomain,
        }))
        .send()
        .await
        .map_err(|e| AuthError::ProviderUnavailable(e.to_string()))?;

    match resp.status().as_u16() {
        200 => {
            let body: AuthVerifyResponse = resp
                .json()
                .await
                .map_err(|e| AuthError::ProviderUnavailable(format!("bad response: {e}")))?;
            Ok(body.subdomains)
        }
        401 | 403 => {
            let msg = resp
                .json::<AuthErrorResponse>()
                .await
                .map(|r| r.error)
                .unwrap_or_else(|_| "invalid token".into());
            Err(AuthError::InvalidToken(msg))
        }
        status => Err(AuthError::ProviderUnavailable(format!(
            "unexpected status {status}"
        ))),
    }
}

/// Check if a requested subdomain matches any allowed pattern.
/// Supports exact match and wildcard suffix (e.g. "myapp-*" matches "myapp-feat-123").
pub fn subdomain_matches(patterns: &[String], subdomain: &str) -> bool {
    patterns.iter().any(|pattern| {
        if let Some(prefix) = pattern.strip_suffix('*') {
            subdomain.starts_with(prefix)
        } else {
            pattern == subdomain
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdomain_matches_exact() {
        let patterns = vec!["myapp".into(), "other".into()];
        assert!(subdomain_matches(&patterns, "myapp"));
        assert!(subdomain_matches(&patterns, "other"));
        assert!(!subdomain_matches(&patterns, "nope"));
    }

    #[test]
    fn subdomain_matches_wildcard() {
        let patterns = vec!["myapp-*".into()];
        assert!(subdomain_matches(&patterns, "myapp-dev"));
        assert!(subdomain_matches(&patterns, "myapp-feat-123"));
        assert!(subdomain_matches(&patterns, "myapp-"));
        assert!(!subdomain_matches(&patterns, "myapp"));
        assert!(!subdomain_matches(&patterns, "other"));
    }

    #[test]
    fn subdomain_matches_mixed() {
        let patterns = vec!["prod".into(), "staging-*".into()];
        assert!(subdomain_matches(&patterns, "prod"));
        assert!(subdomain_matches(&patterns, "staging-v2"));
        assert!(!subdomain_matches(&patterns, "staging"));
        assert!(!subdomain_matches(&patterns, "dev"));
    }

    #[test]
    fn subdomain_matches_empty_patterns() {
        let patterns: Vec<String> = vec![];
        assert!(!subdomain_matches(&patterns, "anything"));
    }
}
