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
  "like_count,comment_count,music_id,hashtag_names,username,effect_ids,voice_to_text";

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

  // ── Token management ──────────────────────────────────────────────────────

  async refreshToken(): Promise<TokenResponse> {
    return this.tokens.refresh();
  }
}
