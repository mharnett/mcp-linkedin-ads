import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LinkedInAdsAuthError,
  LinkedInAdsRateLimitError,
  LinkedInAdsServiceError,
  classifyError,
  validateCredentials,
} from "./errors.js";

describe("classifyError", () => {
  it("classifies 401 status as LinkedInAdsAuthError", () => {
    const error = { status: 401, message: "Unauthorized" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsAuthError);
    expect(result.message).toContain("Auth failed");
  });

  it("classifies 403 status as LinkedInAdsAuthError", () => {
    const error = { status: 403, message: "Forbidden" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsAuthError);
  });

  it("classifies invalid_grant message as LinkedInAdsAuthError", () => {
    const error = { message: "invalid_grant: token revoked" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsAuthError);
  });

  it("classifies OAuth token refresh failed as LinkedInAdsAuthError", () => {
    const error = { message: "OAuth token refresh failed: 401" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsAuthError);
  });

  it("classifies expired token message as LinkedInAdsAuthError", () => {
    const error = { message: "Token has expired" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsAuthError);
  });

  it("classifies InvalidAccessToken message as LinkedInAdsAuthError", () => {
    const error = { message: "InvalidAccessToken: bad token" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsAuthError);
  });

  it("classifies 429 status as LinkedInAdsRateLimitError", () => {
    const error = { status: 429, message: "Too many requests" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsRateLimitError);
    expect((result as LinkedInAdsRateLimitError).retryAfterMs).toBe(60_000);
  });

  it("classifies throttle message as LinkedInAdsRateLimitError", () => {
    const error = { message: "Request throttle limit reached" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsRateLimitError);
  });

  it("classifies rate message as LinkedInAdsRateLimitError", () => {
    const error = { message: "rate limit exceeded" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsRateLimitError);
  });

  it("classifies 500 status as LinkedInAdsServiceError", () => {
    const error = { status: 500, message: "Internal server error" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsServiceError);
    expect(result.message).toContain("server error");
  });

  it("classifies 503 status as LinkedInAdsServiceError", () => {
    const error = { status: 503, message: "Service unavailable" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsServiceError);
  });

  it("classifies ServiceUnavailable message as LinkedInAdsServiceError", () => {
    const error = { message: "ServiceUnavailable: try again later" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(LinkedInAdsServiceError);
  });

  it("passes through generic errors unchanged", () => {
    const error = new Error("Something else went wrong");
    const result = classifyError(error);
    expect(result).toBe(error);
    expect(result).not.toBeInstanceOf(LinkedInAdsAuthError);
    expect(result).not.toBeInstanceOf(LinkedInAdsRateLimitError);
    expect(result).not.toBeInstanceOf(LinkedInAdsServiceError);
  });

  it("passes through errors with non-matching status codes", () => {
    const error = { status: 400, message: "Bad request" };
    const result = classifyError(error);
    expect(result).toBe(error);
  });
});

describe("validateCredentials", () => {
  const envKeys = [
    "LINKEDIN_ADS_ACCESS_TOKEN",
    "LINKEDIN_ADS_REFRESH_TOKEN",
  ];

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("returns valid when access token is set", () => {
    process.env.LINKEDIN_ADS_ACCESS_TOKEN = "test-token";
    delete process.env.LINKEDIN_ADS_REFRESH_TOKEN;
    const result = validateCredentials();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("returns valid when refresh token is set", () => {
    delete process.env.LINKEDIN_ADS_ACCESS_TOKEN;
    process.env.LINKEDIN_ADS_REFRESH_TOKEN = "test-refresh";
    const result = validateCredentials();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("returns valid when both tokens are set", () => {
    process.env.LINKEDIN_ADS_ACCESS_TOKEN = "test-token";
    process.env.LINKEDIN_ADS_REFRESH_TOKEN = "test-refresh";
    const result = validateCredentials();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("detects missing credentials when no tokens set", () => {
    delete process.env.LINKEDIN_ADS_ACCESS_TOKEN;
    delete process.env.LINKEDIN_ADS_REFRESH_TOKEN;
    const result = validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["LINKEDIN_ADS_ACCESS_TOKEN or LINKEDIN_ADS_REFRESH_TOKEN"]);
  });

  it("detects empty string tokens as missing", () => {
    process.env.LINKEDIN_ADS_ACCESS_TOKEN = "  ";
    process.env.LINKEDIN_ADS_REFRESH_TOKEN = "  ";
    const result = validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["LINKEDIN_ADS_ACCESS_TOKEN or LINKEDIN_ADS_REFRESH_TOKEN"]);
  });
});
