// ============================================
// TYPED ERRORS (mirrors motion-mcp / bing-ads pattern)
// ============================================

export class LinkedInAdsAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LinkedInAdsAuthError";
  }
}

export class LinkedInAdsRateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    cause?: unknown,
  ) {
    super(`LinkedIn Ads rate limited, retry after ${retryAfterMs}ms`);
    this.name = "LinkedInAdsRateLimitError";
    this.cause = cause;
  }
}

export class LinkedInAdsServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LinkedInAdsServiceError";
  }
}

// ============================================
// STARTUP CREDENTIAL VALIDATION
// ============================================

export function validateCredentials(): { valid: boolean; missing: string[] } {
  // Need either an access token OR (refresh token + client credentials)
  const hasAccessToken = !!process.env.LINKEDIN_ADS_ACCESS_TOKEN?.trim();
  const hasRefreshToken = !!process.env.LINKEDIN_ADS_REFRESH_TOKEN?.trim();
  if (hasAccessToken || hasRefreshToken) {
    // Basic format validation: token should have reasonable length > 10 chars
    const token = (process.env.LINKEDIN_ADS_ACCESS_TOKEN || process.env.LINKEDIN_ADS_REFRESH_TOKEN || "").trim();
    if (token.length > 0 && token.length < 10) {
      return { valid: false, missing: ["LINKEDIN_ADS token (format: too short, expected length > 10)"] };
    }
    return { valid: true, missing: [] };
  }
  return {
    valid: false,
    missing: ["LINKEDIN_ADS_ACCESS_TOKEN or LINKEDIN_ADS_REFRESH_TOKEN"],
  };
}

export function classifyError(error: any): Error {
  const message = error?.message || String(error);
  const status = error?.status;
  // Check response body for error objects (LinkedIn REST API error structures)
  const bodyError = error?.response?.body?.error || error?.data?.error || error?.errors?.[0];

  if (
    status === 401 ||
    status === 403 ||
    message.includes("invalid_grant") ||
    message.includes("OAuth token refresh failed") ||
    message.includes("expired") ||
    message.includes("InvalidAccessToken") ||
    bodyError?.status === 401
  ) {
    return new LinkedInAdsAuthError(
      `LinkedIn Ads auth failed: ${message}. Token may be expired. Re-authenticate and update Keychain.`,
      error,
    );
  }

  if (status === 429 || message.includes("throttle") || message.includes("rate")) {
    const retryMs = 60_000;
    return new LinkedInAdsRateLimitError(retryMs, error);
  }

  if (status >= 500 || message.includes("ServiceUnavailable")) {
    return new LinkedInAdsServiceError(`LinkedIn API server error: ${message}`, error);
  }

  return error;
}
