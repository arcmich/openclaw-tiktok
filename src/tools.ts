import type { TikTokApiClient } from "./api-client.js";
import type { PostInfo, PrivacyLevel } from "./types.js";
import type { Config } from "./config-schema.js";

const PRIVACY_ENUM = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
];

/** Build a PostInfo object, falling back to the configured default privacy level. */
function makePostInfo(
  cfg: Config,
  fields: Partial<PostInfo> & { privacy_level?: PrivacyLevel }
): PostInfo {
  return {
    privacy_level: cfg.defaultPrivacyLevel ?? "SELF_ONLY",
    ...fields,
  };
}

/**
 * Returns an array of OpenClaw agent tool definitions that expose TikTok
 * management capabilities: user info, feed, publishing, status polling,
 * token refresh, and (optionally) research tools.
 */
export function buildTools(client: TikTokApiClient, cfg: Config) {
  const core = [
    // ── Account ──────────────────────────────────────────────────────────────

    {
      name: "tiktok_get_user_info",
      description:
        "Get the connected TikTok account's profile: display name, avatar, " +
        "bio, follower/following counts, total likes, and video count.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const res = await client.getUserInfo();
        return res.user;
      },
    },

    {
      name: "tiktok_get_creator_info",
      description:
        "Query the creator's TikTok capabilities: available privacy levels, " +
        "whether duet/stitch/comments are enabled, and the maximum allowed " +
        "video duration.",
      parameters: { type: "object", properties: {} },
      execute: async () => client.getCreatorInfo(),
    },

    // ── Feed ──────────────────────────────────────────────────────────────────

    {
      name: "tiktok_list_videos",
      description:
        "Fetch a paginated list of the authenticated user's TikTok videos, " +
        "including titles, descriptions, view/like/comment/share counts, and " +
        "privacy level.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of videos to return (1–20, default 10)",
          },
          cursor: {
            type: "number",
            description:
              "Pagination cursor from a previous response (default 0)",
          },
        },
      },
      execute: async ({
        limit = 10,
        cursor = 0,
      }: {
        limit?: number;
        cursor?: number;
      }) => client.listVideos(limit, cursor),
    },

    {
      name: "tiktok_get_video",
      description:
        "Fetch full details for one or more specific TikTok videos by their IDs.",
      parameters: {
        type: "object",
        required: ["videoIds"],
        properties: {
          videoIds: {
            type: "array",
            items: { type: "string" },
            description: "List of TikTok video IDs (up to 20)",
          },
        },
      },
      execute: async ({ videoIds }: { videoIds: string[] }) => {
        if (videoIds.length > 20) {
          throw new Error("Maximum 20 video IDs per request.");
        }
        return client.queryVideo(videoIds);
      },
    },

    // ── Publishing ────────────────────────────────────────────────────────────

    {
      name: "tiktok_post_video_url",
      description:
        "Publish a video to TikTok by providing a publicly accessible URL. " +
        "TikTok pulls and processes the video directly. Returns immediately " +
        "with a publish_id — use tiktok_get_publish_status to check progress.",
      parameters: {
        type: "object",
        required: ["videoUrl"],
        properties: {
          videoUrl: {
            type: "string",
            description:
              "Publicly accessible HTTPS URL of the video (MP4/MOV/WEBM, " +
              "max 4GB, 60s for standard / up to 10min for eligible accounts)",
          },
          title: {
            type: "string",
            description:
              "Video caption/title (max 2200 UTF-16 characters, supports hashtags)",
          },
          privacyLevel: {
            type: "string",
            enum: PRIVACY_ENUM,
            description: `Privacy level (default: ${cfg.defaultPrivacyLevel ?? "SELF_ONLY"})`,
          },
          disableDuet: {
            type: "boolean",
            description: "Disable duet feature (default false)",
          },
          disableStitch: {
            type: "boolean",
            description: "Disable stitch feature (default false)",
          },
          disableComment: {
            type: "boolean",
            description: "Disable comments (default false)",
          },
          coverTimestampMs: {
            type: "number",
            description:
              "Timestamp (ms from start) to use as the video thumbnail",
          },
        },
      },
      execute: async ({
        videoUrl,
        title,
        privacyLevel,
        disableDuet,
        disableStitch,
        disableComment,
        coverTimestampMs,
      }: {
        videoUrl: string;
        title?: string;
        privacyLevel?: PrivacyLevel;
        disableDuet?: boolean;
        disableStitch?: boolean;
        disableComment?: boolean;
        coverTimestampMs?: number;
      }) => {
        const postInfo = makePostInfo(cfg, {
          ...(title ? { title } : {}),
          ...(privacyLevel ? { privacy_level: privacyLevel } : {}),
          ...(disableDuet !== undefined ? { disable_duet: disableDuet } : {}),
          ...(disableStitch !== undefined ? { disable_stitch: disableStitch } : {}),
          ...(disableComment !== undefined ? { disable_comment: disableComment } : {}),
          ...(coverTimestampMs !== undefined
            ? { video_cover_timestamp_ms: coverTimestampMs }
            : {}),
        });

        const res = await client.publishVideoFromUrl(videoUrl, postInfo);
        return { publishId: res.publish_id };
      },
    },

    {
      name: "tiktok_post_video_and_wait",
      description:
        "Publish a video to TikTok from a URL and wait for it to finish " +
        "processing before returning. Blocks until PUBLISH_COMPLETE or FAILED. " +
        "Use tiktok_post_video_url + tiktok_get_publish_status for non-blocking posting.",
      parameters: {
        type: "object",
        required: ["videoUrl"],
        properties: {
          videoUrl: {
            type: "string",
            description: "Publicly accessible HTTPS URL of the video",
          },
          title: {
            type: "string",
            description: "Video caption/title (max 2200 chars, supports hashtags)",
          },
          privacyLevel: {
            type: "string",
            enum: PRIVACY_ENUM,
            description: `Privacy level (default: ${cfg.defaultPrivacyLevel ?? "SELF_ONLY"})`,
          },
          disableDuet: { type: "boolean" },
          disableStitch: { type: "boolean" },
          disableComment: { type: "boolean" },
        },
      },
      execute: async ({
        videoUrl,
        title,
        privacyLevel,
        disableDuet,
        disableStitch,
        disableComment,
      }: {
        videoUrl: string;
        title?: string;
        privacyLevel?: PrivacyLevel;
        disableDuet?: boolean;
        disableStitch?: boolean;
        disableComment?: boolean;
      }) => {
        const postInfo = makePostInfo(cfg, {
          ...(title ? { title } : {}),
          ...(privacyLevel ? { privacy_level: privacyLevel } : {}),
          ...(disableDuet !== undefined ? { disable_duet: disableDuet } : {}),
          ...(disableStitch !== undefined ? { disable_stitch: disableStitch } : {}),
          ...(disableComment !== undefined ? { disable_comment: disableComment } : {}),
        });

        const init = await client.publishVideoFromUrl(videoUrl, postInfo);
        const status = await client.waitForPublish(init.publish_id);
        return {
          publishId: init.publish_id,
          status: status.status,
          postIds: status.publicly_available_post_id ?? [],
          failReason: status.fail_reason,
        };
      },
    },

    {
      name: "tiktok_post_photo",
      description:
        "Publish a photo (or photo slideshow up to 35 images) to TikTok. " +
        "Images must be at publicly accessible HTTPS URLs. " +
        "Returns a publish_id — use tiktok_get_publish_status to check progress.",
      parameters: {
        type: "object",
        required: ["photoUrls"],
        properties: {
          photoUrls: {
            type: "array",
            items: { type: "string" },
            description:
              "List of 1–35 publicly accessible HTTPS image URLs (JPEG/PNG)",
          },
          title: {
            type: "string",
            description:
              "Caption/title for the post (max 2200 characters, supports hashtags)",
          },
          privacyLevel: {
            type: "string",
            enum: PRIVACY_ENUM,
            description: `Privacy level (default: ${cfg.defaultPrivacyLevel ?? "SELF_ONLY"})`,
          },
          coverIndex: {
            type: "number",
            description:
              "0-based index of the photo to use as the cover (default 0)",
          },
          disableComment: { type: "boolean" },
        },
      },
      execute: async ({
        photoUrls,
        title,
        privacyLevel,
        coverIndex = 0,
        disableComment,
      }: {
        photoUrls: string[];
        title?: string;
        privacyLevel?: PrivacyLevel;
        coverIndex?: number;
        disableComment?: boolean;
      }) => {
        if (photoUrls.length < 1 || photoUrls.length > 35) {
          throw new Error("Photo posts require between 1 and 35 images.");
        }

        const postInfo = makePostInfo(cfg, {
          ...(title ? { title } : {}),
          ...(privacyLevel ? { privacy_level: privacyLevel } : {}),
          ...(disableComment !== undefined ? { disable_comment: disableComment } : {}),
        });

        const res = await client.publishPhoto(photoUrls, postInfo, coverIndex);
        return { publishId: res.publish_id };
      },
    },

    // ── Publish status ─────────────────────────────────────────────────────

    {
      name: "tiktok_get_publish_status",
      description:
        "Check the processing/publish status of a video or photo post. " +
        "Status values: PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, " +
        "SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED.",
      parameters: {
        type: "object",
        required: ["publishId"],
        properties: {
          publishId: {
            type: "string",
            description:
              "The publish_id returned by tiktok_post_video_url or tiktok_post_photo",
          },
        },
      },
      execute: async ({ publishId }: { publishId: string }) => {
        const res = await client.getPublishStatus(publishId);
        return res.publish_item;
      },
    },

    // ── Token ──────────────────────────────────────────────────────────────

    {
      name: "tiktok_refresh_token",
      description:
        "Manually force-refresh the TikTok OAuth access token using the " +
        "stored refresh token. The plugin refreshes automatically when needed, " +
        "so this tool is only needed for diagnostics.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const tok = await client.refreshToken();
        return {
          success: true,
          expiresInSeconds: tok.expires_in,
          scope: tok.scope,
        };
      },
    },
  ];

  // ── Research tools (optional, require TikTok Research API approval) ────────

  const research = [
    {
      name: "tiktok_get_video_comments",
      description:
        "Fetch comments on a public TikTok video. " +
        "Requires Research API access (enableResearchTools: true in config).",
      parameters: {
        type: "object",
        required: ["videoId"],
        properties: {
          videoId: { type: "string", description: "TikTok video ID" },
          limit: {
            type: "number",
            description: "Number of comments to return (1–100, default 20)",
          },
          cursor: {
            type: "number",
            description: "Pagination cursor from a previous response",
          },
        },
      },
      execute: async ({
        videoId,
        limit = 20,
        cursor = 0,
      }: {
        videoId: string;
        limit?: number;
        cursor?: number;
      }) => client.getVideoComments(videoId, limit, cursor),
    },

    {
      name: "tiktok_search_videos",
      description:
        "Search public TikTok videos by keywords within a date range. " +
        "Returns engagement metrics, hashtags, region, and creator username. " +
        "Requires Research API access (enableResearchTools: true in config).",
      parameters: {
        type: "object",
        required: ["keywords", "startDate", "endDate"],
        properties: {
          keywords: {
            type: "array",
            items: { type: "string" },
            description:
              "List of keywords to search for (all must match — AND logic)",
          },
          startDate: {
            type: "string",
            description: "Start of the date range in YYYYMMDD format",
          },
          endDate: {
            type: "string",
            description: "End of the date range in YYYYMMDD format",
          },
          limit: {
            type: "number",
            description: "Number of results to return (1–100, default 10)",
          },
          cursor: {
            type: "number",
            description: "Pagination cursor for subsequent pages",
          },
          searchId: {
            type: "string",
            description:
              "search_id from a previous response — required for pagination " +
              "beyond the first page",
          },
        },
      },
      execute: async ({
        keywords,
        startDate,
        endDate,
        limit = 10,
        cursor = 0,
        searchId = "",
      }: {
        keywords: string[];
        startDate: string;
        endDate: string;
        limit?: number;
        cursor?: number;
        searchId?: string;
      }) =>
        client.searchVideos(keywords, startDate, endDate, limit, cursor, searchId),
    },
  ];

  return cfg.enableResearchTools ? [...core, ...research] : core;
}
