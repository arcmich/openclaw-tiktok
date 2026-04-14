import type { TokenManager } from "./token-manager.js";
import type {
  TikTokApiResponse,
  TikTokUser,
  TikTokVideo,
  VideoListResponse,
  CreatorInfo,
  PostInfo,
  PublishInitResponse,
  PublishStatusResponse,
  PublishStatus,
  CommentListResponse,
  ResearchVideoResponse,
  ResearchVideo,
  UserFollowersResponse,
  UserFollowingResponse,
  UserLikedVideosResponse,
  PinnedVideosResponse,
  TokenResponse,
} from "./types.js";

const BASE = "https://open.tiktokapis.com/v2";

// Fields to request for each resource type
const VIDEO_FIELDS =
  "id,title,video_description,duration,cover_image_url,embed_link," +
  "view_count,like_count,comment_count,share_count,create_time,privacy_level";

const USER_FIELDS =
  "open_id,union_id,avatar_url,display_name,bio_description," +
  "profile_deep_link,is_verified,follower_count,following_count," +
  "likes_count,video_count";

const COMMENT_FIELDS =
  "id,text,like_count,reply_count,parent_comment_id,create_time";

const RESEARCH_VIDEO_FIELDS =
  "id,video_description,create_time,region_code,share_count,view_count," +
  "like_count,comment_count,music_id,hashtag_names,username,effect_ids," +
  "voice_to_text,video_duration";

const RESEARCH_USER_FIELDS =
  "username,display_name,bio_description,avatar_url,is_verified," +
  "follower_count,following_count,likes_count,video_count";

export class TikTokApiClient {
  constructor(
    private readonly tokens: TokenManager,
    private readonly pollIntervalMs: number,
    private readonly pollTimeoutMs: number
  ) {}

  // ── Low-level helpers ─────────────────────────────────────────────────────

  private async authHeader(): Promise<{ Authorization: string }> {
    return { Authorization: `Bearer ${await this.tokens.getAccessToken()}` };
  }

  private async get<T>(
    path: string,
    queryParams: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { ...(await this.authHeader()) },
    });
    return this.parseResponse<T>(res);
  }

  private async post<T>(
    path: string,
    body: unknown,
    queryParams: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        ...(await this.authHeader()),
      },
      body: JSON.stringify(body),
    });
    return this.parseResponse<T>(res);
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    const json = (await res.json()) as TikTokApiResponse<T>;

    if (!res.ok || (json.error && json.error.code !== "ok")) {
      const code = json.error?.code ?? res.status;
      const msg = json.error?.message ?? res.statusText;
      throw new Error(`TikTok API error [${code}]: ${msg}`);
    }

    return json.data;
  }

  // ── User ──────────────────────────────────────────────────────────────────

  async getUserInfo(): Promise<{ user: TikTokUser }> {
    return this.get("/user/info/", { fields: USER_FIELDS });
  }

  // ── Video list ────────────────────────────────────────────────────────────

  async listVideos(
    maxCount = 10,
    cursor = 0
  ): Promise<VideoListResponse> {
    return this.post(
      "/video/list/",
      { max_count: Math.min(maxCount, 20), cursor },
      { fields: VIDEO_FIELDS }
    );
  }

  async queryVideo(videoIds: string[]): Promise<{ videos: TikTokVideo[] }> {
    return this.post(
      "/video/query/",
      { filters: { video_ids: videoIds } },
      { fields: VIDEO_FIELDS }
    );
  }

  // ── Creator info ──────────────────────────────────────────────────────────

  async getCreatorInfo(): Promise<CreatorInfo> {
    return this.post("/post/publish/creator_info/query/", {});
  }

  // ── Publish video (PULL_FROM_URL — simplest path) ─────────────────────────

  async publishVideoFromUrl(
    videoUrl: string,
    postInfo: PostInfo
  ): Promise<PublishInitResponse> {
    return this.post("/post/publish/video/init/", {
      post_info: postInfo,
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    });
  }

  // ── Publish video (FILE_UPLOAD — chunked) ─────────────────────────────────

  async initVideoFileUpload(
    postInfo: PostInfo,
    videoSizeBytes: number,
    chunkSizeBytes: number
  ): Promise<PublishInitResponse> {
    const totalChunks = Math.ceil(videoSizeBytes / chunkSizeBytes);
    return this.post("/post/publish/video/init/", {
      post_info: postInfo,
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSizeBytes,
        chunk_size: chunkSizeBytes,
        total_chunk_count: totalChunks,
      },
    });
  }

  async uploadVideoChunk(
    uploadUrl: string,
    chunk: Uint8Array,
    chunkIndex: number,
    totalChunks: number,
    totalSize: number,
    contentType = "video/mp4"
  ): Promise<void> {
    const start = chunkIndex * chunk.length;
    const end = start + chunk.length - 1;

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      },
      body: chunk,
    });

    if (!res.ok) {
      throw new Error(
        `TikTok chunk upload failed (chunk ${chunkIndex + 1}/${totalChunks}): ${res.status} ${res.statusText}`
      );
    }
  }

  // ── Publish photo ─────────────────────────────────────────────────────────

  async publishPhoto(
    photoUrls: string[],
    postInfo: PostInfo,
    coverIndex = 0
  ): Promise<PublishInitResponse> {
    return this.post("/post/publish/content/init/", {
      post_info: postInfo,
      source_info: {
        source: "PULL_FROM_URL",
        photo_images: photoUrls,
        photo_cover_index: coverIndex,
      },
    });
  }

  // ── Publish status ────────────────────────────────────────────────────────

  async getPublishStatus(
    publishId: string
  ): Promise<{ publish_item: PublishStatusResponse }> {
    return this.post("/post/publish/status/fetch/", {
      publish_id: publishId,
    });
  }

  /**
   * Poll until the post is published, failed, or the timeout is reached.
   * Returns the final status object.
   */
  async waitForPublish(publishId: string): Promise<PublishStatusResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    const terminalStatuses = new Set<PublishStatus>([
      "PUBLISH_COMPLETE",
      "FAILED",
    ]);

    while (Date.now() < deadline) {
      const res = await this.getPublishStatus(publishId);
      const item = res.publish_item;

      if (terminalStatuses.has(item.status)) {
        return item;
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }

    throw new Error(
      `TikTok publish timed out after ${this.pollTimeoutMs / 1000}s ` +
        `(publish_id: ${publishId})`
    );
  }

  // ── Research: comments ────────────────────────────────────────────────────

  async getVideoComments(
    videoId: string,
    maxCount = 20,
    cursor = 0
  ): Promise<CommentListResponse> {
    return this.post(
      "/research/video/comment/list/",
      { video_id: videoId, max_count: Math.min(maxCount, 100), cursor },
      { fields: COMMENT_FIELDS }
    );
  }

  // ── Research: search videos ───────────────────────────────────────────────

  async searchVideos(
    keywords: string[],
    startDate: string, // YYYYMMDD
    endDate: string,   // YYYYMMDD
    maxCount = 10,
    cursor = 0,
    searchId = ""
  ): Promise<ResearchVideoResponse> {
    return this.post(
      "/research/video/query/",
      {
        query: {
          and: keywords.map((kw) => ({
            operation: "IN",
            field_name: "keyword",
            field_values: [kw],
          })),
        },
        start_date: startDate,
        end_date: endDate,
        max_count: Math.min(maxCount, 100),
        cursor,
        ...(searchId ? { search_id: searchId } : {}),
      },
      { fields: RESEARCH_VIDEO_FIELDS }
    );
  }

  // ── Research: social graph ────────────────────────────────────────────────

  async getUserFollowers(
    username: string,
    maxCount = 100,
    cursor = 0
  ): Promise<UserFollowersResponse> {
    return this.post(
      "/research/user/followers/",
      { username, max_count: Math.min(maxCount, 100), cursor },
      { fields: RESEARCH_USER_FIELDS }
    );
  }

  async getUserFollowing(
    username: string,
    maxCount = 100,
    cursor = 0
  ): Promise<UserFollowingResponse> {
    return this.post(
      "/research/user/following/",
      { username, max_count: Math.min(maxCount, 100), cursor },
      { fields: RESEARCH_USER_FIELDS }
    );
  }

  async getUserLikedVideos(
    username: string,
    maxCount = 20,
    cursor = 0
  ): Promise<UserLikedVideosResponse> {
    return this.post(
      "/research/user/liked_videos/",
      { username, max_count: Math.min(maxCount, 100), cursor },
      { fields: RESEARCH_VIDEO_FIELDS }
    );
  }

  async getUserPinnedVideos(username: string): Promise<PinnedVideosResponse> {
    return this.post(
      "/research/user/pinned_videos/",
      { username },
      { fields: RESEARCH_VIDEO_FIELDS }
    );
  }

  // ── Research: viral / trending discovery ──────────────────────────────────

  /**
   * Find high-performing videos in a niche using the Research API.
   * Filters by hashtag and a minimum view-count threshold.
   */
  async findViralVideos(
    hashtag: string,
    minViewCount: number,
    startDate: string,
    endDate: string,
    regionCode?: string,
    maxCount = 20,
    cursor = 0,
    searchId = ""
  ): Promise<ResearchVideoResponse> {
    const conditions: Array<{ operation: string; field_name: string; field_values: string[] }> = [
      { operation: "EQ", field_name: "hashtag_name", field_values: [hashtag] },
      { operation: "GTE", field_name: "view_count", field_values: [String(minViewCount)] },
    ];

    if (regionCode) {
      conditions.push({ operation: "EQ", field_name: "region_code", field_values: [regionCode] });
    }

    return this.post(
      "/research/video/query/",
      {
        query: { and: conditions },
        start_date: startDate,
        end_date: endDate,
        max_count: Math.min(maxCount, 100),
        cursor,
        ...(searchId ? { search_id: searchId } : {}),
      },
      { fields: RESEARCH_VIDEO_FIELDS }
    );
  }

  /**
   * Paginate through the authenticated user's own video list up to maxTotal.
   * Used internally by performance analysis tools.
   */
  async fetchAllMyVideos(maxTotal = 100): Promise<TikTokVideo[]> {
    const videos: TikTokVideo[] = [];
    let cursor = 0;
    let hasMore = true;

    while (hasMore && videos.length < maxTotal) {
      const batchSize = Math.min(20, maxTotal - videos.length);
      const res = await this.listVideos(batchSize, cursor);
      videos.push(...res.videos);
      hasMore = res.has_more;
      cursor = res.cursor;
    }

    return videos;
  }

  // ── Token management ──────────────────────────────────────────────────────

  async refreshToken(): Promise<TokenResponse> {
    return this.tokens.refresh();
  }
}
