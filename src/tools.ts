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

    // ── Growth: performance analysis (no Research API required) ──────────────

    {
      name: "tiktok_analyze_my_performance",
      description:
        "Fetch up to 100 of your own TikTok videos and return a ranked " +
        "performance breakdown: top/bottom performers, average engagement rate, " +
        "view-count distribution, and patterns in what content is working. " +
        "Use this to decide what to post more of.",
      parameters: {
        type: "object",
        properties: {
          sampleSize: {
            type: "number",
            description:
              "How many recent videos to analyse (max 100, default 60)",
          },
        },
      },
      execute: async ({ sampleSize = 60 }: { sampleSize?: number }) => {
        const videos = await client.fetchAllMyVideos(Math.min(sampleSize, 100));

        if (!videos.length) {
          return { error: "No videos found on this account." };
        }

        const withEngagement = videos.map((v) => {
          const views = v.view_count ?? 0;
          const interactions = (v.like_count ?? 0) + (v.comment_count ?? 0) + (v.share_count ?? 0);
          const engagementRate = views > 0 ? interactions / views : 0;
          return { ...v, engagementRate };
        });

        const sorted = [...withEngagement].sort(
          (a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)
        );

        const totalViews = withEngagement.reduce((s, v) => s + (v.view_count ?? 0), 0);
        const avgViews = Math.round(totalViews / videos.length);
        const avgEngRate =
          withEngagement.reduce((s, v) => s + v.engagementRate, 0) / videos.length;

        const topVideos = sorted.slice(0, 5).map((v) => ({
          id: v.id,
          title: v.title ?? v.video_description?.slice(0, 80) ?? "(no title)",
          views: v.view_count,
          likes: v.like_count,
          comments: v.comment_count,
          shares: v.share_count,
          engagementRate: (v.engagementRate * 100).toFixed(2) + "%",
          duration: v.duration,
          postedAt: v.create_time
            ? new Date(v.create_time * 1000).toISOString()
            : null,
        }));

        const bottomVideos = sorted.slice(-5).map((v) => ({
          id: v.id,
          title: v.title ?? v.video_description?.slice(0, 80) ?? "(no title)",
          views: v.view_count,
          engagementRate: (v.engagementRate * 100).toFixed(2) + "%",
        }));

        return {
          totalVideosAnalyzed: videos.length,
          averageViews: avgViews,
          averageEngagementRate: (avgEngRate * 100).toFixed(2) + "%",
          totalViewsAcrossAll: totalViews,
          topPerformers: topVideos,
          bottomPerformers: bottomVideos,
          tip: avgEngRate < 0.03
            ? "Engagement rate is below 3% — try enabling duets/stitches and responding to comments to boost interaction signals."
            : "Engagement is healthy. Double down on the style/length of your top performers.",
        };
      },
    },

    {
      name: "tiktok_find_optimal_post_time",
      description:
        "Analyse your own video post history to infer which hours of the day " +
        "produce the highest average view count. Returns the top 3 posting hours " +
        "(UTC) and average views per hour bucket.",
      parameters: {
        type: "object",
        properties: {
          sampleSize: {
            type: "number",
            description:
              "How many recent videos to analyse (max 100, default 60)",
          },
        },
      },
      execute: async ({ sampleSize = 60 }: { sampleSize?: number }) => {
        const videos = await client.fetchAllMyVideos(Math.min(sampleSize, 100));

        const withTime = videos.filter(
          (v) => v.create_time !== undefined && v.view_count !== undefined
        );

        if (withTime.length < 5) {
          return {
            error:
              "Not enough data (need ≥5 videos with timestamps). Post more " +
              "content and try again.",
          };
        }

        // Bucket views by hour of day (UTC)
        const buckets: Record<number, { total: number; count: number }> = {};
        for (const v of withTime) {
          const hour = new Date((v.create_time! * 1000)).getUTCHours();
          if (!buckets[hour]) buckets[hour] = { total: 0, count: 0 };
          buckets[hour].total += v.view_count!;
          buckets[hour].count += 1;
        }

        const hourStats = Object.entries(buckets)
          .map(([h, { total, count }]) => ({
            hourUTC: Number(h),
            avgViews: Math.round(total / count),
            sampleCount: count,
          }))
          .sort((a, b) => b.avgViews - a.avgViews);

        return {
          videosAnalyzed: withTime.length,
          topPostingHoursUTC: hourStats.slice(0, 3),
          allHourStats: hourStats,
          note:
            "Times are in UTC. Convert to your audience's local timezone. " +
            "Hours with sampleCount < 3 are less reliable.",
        };
      },
    },

    {
      name: "tiktok_post_growth_optimized",
      description:
        "Post a video with all settings configured for maximum algorithmic reach: " +
        "duets and stitches enabled (encourages derivative content which re-surfaces " +
        "your video), comments open (comment velocity is a top ranking signal), " +
        "and public visibility. Supply a caption with 3–5 hashtags (1-2 trending, " +
        "1-2 niche-specific, 1 branded) for the best keyword indexing.",
      parameters: {
        type: "object",
        required: ["videoUrl", "caption"],
        properties: {
          videoUrl: {
            type: "string",
            description: "Publicly accessible HTTPS URL of the video",
          },
          caption: {
            type: "string",
            description:
              "Caption text with hashtags. Ideal format: hook sentence + " +
              "3–5 hashtags e.g. 'Crazy morning routine 🌅 #morningroutine #productivity #wellness'",
          },
          privacyLevel: {
            type: "string",
            enum: PRIVACY_ENUM,
            description:
              "Visibility (default: PUBLIC_TO_EVERYONE for max reach). " +
              "Use SELF_ONLY while testing.",
          },
          coverTimestampMs: {
            type: "number",
            description:
              "Thumbnail frame offset in ms. The first 1–2 seconds make the " +
              "biggest impression — choose a visually striking frame.",
          },
          waitForPublish: {
            type: "boolean",
            description:
              "If true, block until TikTok confirms the video is live (default false)",
          },
        },
      },
      execute: async ({
        videoUrl,
        caption,
        privacyLevel = "PUBLIC_TO_EVERYONE",
        coverTimestampMs,
        waitForPublish = false,
      }: {
        videoUrl: string;
        caption: string;
        privacyLevel?: PrivacyLevel;
        coverTimestampMs?: number;
        waitForPublish?: boolean;
      }) => {
        const postInfo = makePostInfo(cfg, {
          title: caption,
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_stitch: false,
          disable_comment: false,
          ...(coverTimestampMs !== undefined
            ? { video_cover_timestamp_ms: coverTimestampMs }
            : {}),
        });

        const init = await client.publishVideoFromUrl(videoUrl, postInfo);

        if (!waitForPublish) {
          return {
            publishId: init.publish_id,
            status: "PENDING",
            settings: {
              duetsEnabled: true,
              stitchesEnabled: true,
              commentsEnabled: true,
              privacyLevel,
            },
          };
        }

        const status = await client.waitForPublish(init.publish_id);
        return {
          publishId: init.publish_id,
          status: status.status,
          postIds: status.publicly_available_post_id ?? [],
          failReason: status.fail_reason,
          settings: {
            duetsEnabled: true,
            stitchesEnabled: true,
            commentsEnabled: true,
            privacyLevel,
          },
        };
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

  const researchGrowth = [
    {
      name: "tiktok_find_viral_videos",
      description:
        "Find public TikTok videos in a niche that have crossed a view-count " +
        "threshold — ideal for trend spotting and content inspiration. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["hashtag", "startDate", "endDate"],
        properties: {
          hashtag: {
            type: "string",
            description: "Niche hashtag to search (without #)",
          },
          minViews: {
            type: "number",
            description: "Minimum view count threshold (default 100000)",
          },
          startDate: {
            type: "string",
            description: "Start date in YYYYMMDD format",
          },
          endDate: {
            type: "string",
            description: "End date in YYYYMMDD format (max 30 days after start)",
          },
          regionCode: {
            type: "string",
            description:
              "2-letter ISO region code to filter by (e.g. US, GB, AU). " +
              "Omit for global results.",
          },
          limit: {
            type: "number",
            description: "Number of results (1–100, default 20)",
          },
        },
      },
      execute: async ({
        hashtag,
        minViews = 100_000,
        startDate,
        endDate,
        regionCode,
        limit = 20,
      }: {
        hashtag: string;
        minViews?: number;
        startDate: string;
        endDate: string;
        regionCode?: string;
        limit?: number;
      }) =>
        client.findViralVideos(hashtag, minViews, startDate, endDate, regionCode, limit),
    },

    {
      name: "tiktok_find_trending_audio",
      description:
        "Find the most-used music tracks on high-performing videos in a " +
        "hashtag niche. Audio trends are the fastest-moving FYP signal — " +
        "posting on a trending sound gives a significant reach boost. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["hashtag", "startDate", "endDate"],
        properties: {
          hashtag: {
            type: "string",
            description: "Niche hashtag to analyse (without #)",
          },
          minViews: {
            type: "number",
            description: "Minimum view count for videos to include (default 50000)",
          },
          startDate: {
            type: "string",
            description: "Start date in YYYYMMDD format",
          },
          endDate: {
            type: "string",
            description: "End date in YYYYMMDD format",
          },
          topN: {
            type: "number",
            description: "Number of top music IDs to return (default 10)",
          },
        },
      },
      execute: async ({
        hashtag,
        minViews = 50_000,
        startDate,
        endDate,
        topN = 10,
      }: {
        hashtag: string;
        minViews?: number;
        startDate: string;
        endDate: string;
        topN?: number;
      }) => {
        const res = await client.findViralVideos(hashtag, minViews, startDate, endDate, undefined, 100);

        const musicCounts: Record<string, { count: number; totalViews: number }> = {};
        for (const v of res.videos) {
          if (!v.music_id) continue;
          if (!musicCounts[v.music_id]) {
            musicCounts[v.music_id] = { count: 0, totalViews: 0 };
          }
          musicCounts[v.music_id].count += 1;
          musicCounts[v.music_id].totalViews += v.view_count ?? 0;
        }

        const ranked = Object.entries(musicCounts)
          .map(([musicId, { count, totalViews }]) => ({
            musicId,
            videoCount: count,
            totalViews,
            avgViews: Math.round(totalViews / count),
          }))
          .sort((a, b) => b.videoCount - a.videoCount)
          .slice(0, topN);

        return {
          hashtag,
          videosScanned: res.videos.length,
          topTrendingAudio: ranked,
          tip: "Post a video using one of these music IDs to ride the trending sound — TikTok surfaces content on sounds that are gaining velocity.",
        };
      },
    },

    {
      name: "tiktok_get_niche_leaders",
      description:
        "Identify the top creators in a hashtag niche by aggregating their " +
        "video performance. Useful for finding accounts to study, collaborate " +
        "with, or benchmark against. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["hashtag", "startDate", "endDate"],
        properties: {
          hashtag: {
            type: "string",
            description: "Hashtag niche to analyse (without #)",
          },
          startDate: {
            type: "string",
            description: "Start date in YYYYMMDD format",
          },
          endDate: {
            type: "string",
            description: "End date in YYYYMMDD format",
          },
          topN: {
            type: "number",
            description: "Number of top creators to return (default 10)",
          },
        },
      },
      execute: async ({
        hashtag,
        startDate,
        endDate,
        topN = 10,
      }: {
        hashtag: string;
        startDate: string;
        endDate: string;
        topN?: number;
      }) => {
        const res = await client.searchVideos([hashtag], startDate, endDate, 100);

        const creators: Record<
          string,
          { videoCount: number; totalViews: number; totalLikes: number; totalComments: number }
        > = {};

        for (const v of res.videos) {
          if (!v.username) continue;
          if (!creators[v.username]) {
            creators[v.username] = { videoCount: 0, totalViews: 0, totalLikes: 0, totalComments: 0 };
          }
          creators[v.username].videoCount += 1;
          creators[v.username].totalViews += v.view_count ?? 0;
          creators[v.username].totalLikes += v.like_count ?? 0;
          creators[v.username].totalComments += v.comment_count ?? 0;
        }

        const ranked = Object.entries(creators)
          .map(([username, s]) => ({
            username,
            videoCount: s.videoCount,
            totalViews: s.totalViews,
            avgViews: Math.round(s.totalViews / s.videoCount),
            avgEngagementRate:
              s.totalViews > 0
                ? (((s.totalLikes + s.totalComments) / s.totalViews) * 100).toFixed(2) + "%"
                : "0%",
          }))
          .sort((a, b) => b.totalViews - a.totalViews)
          .slice(0, topN);

        return { hashtag, creatorsFound: Object.keys(creators).length, topCreators: ranked };
      },
    },

    {
      name: "tiktok_get_user_liked_videos",
      description:
        "Fetch the list of public videos a TikTok user has liked. " +
        "Useful for understanding what content resonates with a specific audience. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", description: "TikTok username (without @)" },
          limit: { type: "number", description: "Number of results (1–100, default 20)" },
          cursor: { type: "number", description: "Pagination cursor" },
        },
      },
      execute: async ({
        username,
        limit = 20,
        cursor = 0,
      }: { username: string; limit?: number; cursor?: number }) =>
        client.getUserLikedVideos(username, limit, cursor),
    },

    {
      name: "tiktok_get_user_followers",
      description:
        "Fetch a user's follower list with profile data. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", description: "TikTok username (without @)" },
          limit: { type: "number", description: "Number of followers to return (1–100, default 100)" },
          cursor: { type: "number", description: "Pagination cursor" },
        },
      },
      execute: async ({
        username,
        limit = 100,
        cursor = 0,
      }: { username: string; limit?: number; cursor?: number }) =>
        client.getUserFollowers(username, limit, cursor),
    },

    {
      name: "tiktok_get_user_following",
      description:
        "Fetch the list of accounts a TikTok user follows, with profile data. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", description: "TikTok username (without @)" },
          limit: { type: "number", description: "Number of results (1–100, default 100)" },
          cursor: { type: "number", description: "Pagination cursor" },
        },
      },
      execute: async ({
        username,
        limit = 100,
        cursor = 0,
      }: { username: string; limit?: number; cursor?: number }) =>
        client.getUserFollowing(username, limit, cursor),
    },

    {
      name: "tiktok_get_user_pinned_videos",
      description:
        "Get the pinned videos from a TikTok user's profile. Pinned videos " +
        "are the creator's own highlight reel — good for competitor analysis. " +
        "Requires Research API (enableResearchTools: true).",
      parameters: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", description: "TikTok username (without @)" },
        },
      },
      execute: async ({ username }: { username: string }) =>
        client.getUserPinnedVideos(username),
    },
  ];

  return cfg.enableResearchTools
    ? [...core, ...research, ...researchGrowth]
    : core;
}
