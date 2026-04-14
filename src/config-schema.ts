import { Type as T, Static } from "@sinclair/typebox";

export const ConfigSchema = T.Object({
  clientKey: T.String({
    description:
      "TikTok app Client Key from the TikTok Developer Portal " +
      "(App Management → App Detail → Client Key).",
  }),

  clientSecret: T.String({
    description: "TikTok app Client Secret from the TikTok Developer Portal.",
  }),

  accessToken: T.String({
    description:
      "OAuth 2.0 User Access Token. Valid for 24 hours — the plugin will " +
      "auto-refresh using the refresh token when it expires.",
  }),

  refreshToken: T.String({
    description:
      "OAuth 2.0 Refresh Token. Valid for 365 days. Used to obtain new " +
      "access tokens automatically.",
  }),

  openId: T.String({
    description:
      "The user's TikTok open_id returned during OAuth. Required for some " +
      "API calls that scope data to a specific creator.",
  }),

  defaultPrivacyLevel: T.Optional(
    T.Union(
      [
        T.Literal("PUBLIC_TO_EVERYONE"),
        T.Literal("MUTUAL_FOLLOW_FRIENDS"),
        T.Literal("FOLLOWER_OF_CREATOR"),
        T.Literal("SELF_ONLY"),
      ],
      {
        description:
          "Default privacy level used when posting content if not specified " +
          "in the tool call. (default: SELF_ONLY — safe for testing)",
        default: "SELF_ONLY",
      }
    )
  ),

  enableResearchTools: T.Optional(
    T.Boolean({
      description:
        "Enable research API tools (tiktok_search_videos, tiktok_get_video_comments). " +
        "Requires a separate Research API approval from TikTok. (default: false)",
      default: false,
    })
  ),

  pollIntervalMs: T.Optional(
    T.Number({
      description:
        "How often (in ms) to poll for publish status when waiting for a " +
        "video/photo to process. (default: 3000)",
      default: 3000,
    })
  ),

  pollTimeoutMs: T.Optional(
    T.Number({
      description:
        "Maximum time (in ms) to wait for publish status before giving up. " +
        "(default: 120000 — 2 minutes)",
      default: 120000,
    })
  ),
});

export type Config = Static<typeof ConfigSchema>;
