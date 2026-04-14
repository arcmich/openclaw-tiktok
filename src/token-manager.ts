import type { Config } from "./config-schema.js";
import type { TokenResponse } from "./types.js";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/**
 * Manages the short-lived TikTok access token.
 *
 * TikTok access tokens expire after 24 hours. This manager wraps the token
 * refresh call and exposes a `getAccessToken()` method that returns a valid
 * token, refreshing automatically when close to expiry.
 */
export class TokenManager {
  private accessToken: string;
  private expiresAt: number; // epoch ms
  private readonly refreshToken: string;
  private readonly clientKey: string;
  private readonly clientSecret: string;

  // Refresh 5 minutes before actual expiry to avoid edge-case races
  private static readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  constructor(cfg: Config) {
    this.accessToken = cfg.accessToken;
    this.refreshToken = cfg.refreshToken;
    this.clientKey = cfg.clientKey;
    this.clientSecret = cfg.clientSecret;
    // Assume freshly issued — will refresh on first near-expiry detection
    this.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  }

  /** Returns a valid access token, refreshing first if needed. */
  async getAccessToken(): Promise<string> {
    if (Date.now() < this.expiresAt - TokenManager.REFRESH_BUFFER_MS) {
      return this.accessToken;
    }
    await this.refresh();
    return this.accessToken;
  }

  /** Force-refresh the access token using the stored refresh token. */
  async refresh(): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`TikTok token refresh failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { data: TokenResponse; error?: { code: string; message: string } };

    if (json.error && json.error.code !== "ok") {
      throw new Error(
        `TikTok token refresh error: ${json.error.code} — ${json.error.message}`
      );
    }

    const tok = json.data;
    this.accessToken = tok.access_token;
    this.expiresAt = Date.now() + tok.expires_in * 1000;
    return tok;
  }
}
