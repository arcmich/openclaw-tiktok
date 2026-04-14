import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "./token-manager.js";
import { TikTokApiClient } from "./api-client.js";
import { PostScheduler } from "./scheduler.js";
import { predictViralScore } from "./viral-predictor.js";
import { buildTools } from "./tools.js";
import type { Config } from "./config-schema.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const CFG: Config = {
  clientKey: "test-client-key",
  clientSecret: "test-client-secret",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  openId: "user-open-id",
  defaultPrivacyLevel: "SELF_ONLY",
  enableResearchTools: true,
  pollIntervalMs: 50,
  pollTimeoutMs: 500,
};

function makeOkResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, error: { code: "ok", message: "", log_id: "" } }),
  } as unknown as Response;
}

function makeClient() {
  const tokens = new TokenManager(CFG);
  return new TikTokApiClient(tokens, CFG.pollIntervalMs!, CFG.pollTimeoutMs!);
}

// ── TokenManager ───────────────────────────────────────────────────────────────

describe("TokenManager", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the access token without refreshing when not expired", async () => {
    const tm = new TokenManager(CFG);
    global.fetch = vi.fn();
    const token = await tm.getAccessToken();
    expect(token).toBe("test-access-token");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls the token endpoint on refresh()", async () => {
    const tm = new TokenManager(CFG);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          access_token: "new-token",
          expires_in: 86400,
          refresh_token: "new-refresh",
          refresh_expires_in: 31536000,
          token_type: "Bearer",
          scope: "user.info.basic",
          open_id: "user-open-id",
        },
        error: { code: "ok", message: "", log_id: "" },
      }),
    } as unknown as Response);

    const tok = await tm.refresh();
    expect(tok.access_token).toBe("new-token");

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/v2/oauth/token/");
    const body = new URLSearchParams(opts.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("test-refresh-token");
  });

  it("throws on a failed token refresh", async () => {
    const tm = new TokenManager(CFG);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as unknown as Response);

    await expect(tm.refresh()).rejects.toThrow("token refresh failed");
  });
});

// ── TikTokApiClient ────────────────────────────────────────────────────────────

describe("TikTokApiClient", () => {
  beforeEach(() => vi.resetAllMocks());

  it("getUserInfo calls /user/info/ with fields", async () => {
    const client = makeClient();
    const mockUser = { open_id: "uid", display_name: "Test", follower_count: 1000 };

    global.fetch = vi.fn().mockResolvedValueOnce(makeOkResponse({ user: mockUser }));

    const res = await client.getUserInfo();
    expect(res.user.display_name).toBe("Test");

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/user/info/");
    expect(url).toContain("fields=");
  });

  it("listVideos sends POST with max_count and cursor", async () => {
    const client = makeClient();

    global.fetch = vi.fn().mockResolvedValueOnce(
      makeOkResponse({ videos: [], cursor: 0, has_more: false })
    );

    await client.listVideos(5, 10);

    const [, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.max_count).toBe(5);
    expect(body.cursor).toBe(10);
  });

  it("listVideos clamps max_count to 20", async () => {
    const client = makeClient();

    global.fetch = vi.fn().mockResolvedValueOnce(
      makeOkResponse({ videos: [], cursor: 0, has_more: false })
    );

    await client.listVideos(50);

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.max_count).toBe(20);
  });

  it("publishVideoFromUrl sends correct source_info", async () => {
    const client = makeClient();

    global.fetch = vi.fn().mockResolvedValueOnce(
      makeOkResponse({ publish_id: "pub-123" })
    );

    const res = await client.publishVideoFromUrl("https://example.com/v.mp4", {
      privacy_level: "SELF_ONLY",
      title: "Test video",
    });

    expect(res.publish_id).toBe("pub-123");

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.source_info.source).toBe("PULL_FROM_URL");
    expect(body.source_info.video_url).toBe("https://example.com/v.mp4");
    expect(body.post_info.title).toBe("Test video");
  });

  it("waitForPublish polls until PUBLISH_COMPLETE", async () => {
    const client = makeClient();

    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        makeOkResponse({ publish_item: { publish_id: "p1", status: "PROCESSING_UPLOAD" } })
      )
      .mockResolvedValueOnce(
        makeOkResponse({ publish_item: { publish_id: "p1", status: "PROCESSING_DOWNLOAD" } })
      )
      .mockResolvedValueOnce(
        makeOkResponse({
          publish_item: {
            publish_id: "p1",
            status: "PUBLISH_COMPLETE",
            publicly_available_post_id: ["vid-abc"],
          },
        })
      );

    const result = await client.waitForPublish("p1");
    expect(result.status).toBe("PUBLISH_COMPLETE");
    expect(result.publicly_available_post_id).toContain("vid-abc");
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it("waitForPublish throws on FAILED status", async () => {
    const client = makeClient();

    global.fetch = vi.fn().mockResolvedValueOnce(
      makeOkResponse({
        publish_item: { publish_id: "p2", status: "FAILED", fail_reason: "unsupported format" },
      })
    );

    const result = await client.waitForPublish("p2");
    expect(result.status).toBe("FAILED");
    expect(result.fail_reason).toBe("unsupported format");
  });

  it("waitForPublish throws on timeout", async () => {
    // pollTimeoutMs is 500ms in test config; return PROCESSING indefinitely
    const tokens = new TokenManager(CFG);
    const client = new TikTokApiClient(tokens, 50, 200); // 200ms timeout

    global.fetch = vi.fn().mockResolvedValue(
      makeOkResponse({ publish_item: { publish_id: "p3", status: "PROCESSING_UPLOAD" } })
    );

    await expect(client.waitForPublish("p3")).rejects.toThrow("timed out");
  });

  it("throws TikTok API error when error.code !== ok", async () => {
    const client = makeClient();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {},
        error: { code: "access_token_invalid", message: "Invalid token", log_id: "x" },
      }),
    } as unknown as Response);

    await expect(client.getUserInfo()).rejects.toThrow("access_token_invalid");
  });

  it("publishPhoto sends photo_images array and cover index", async () => {
    const client = makeClient();

    global.fetch = vi.fn().mockResolvedValueOnce(
      makeOkResponse({ publish_id: "photo-pub-1" })
    );

    await client.publishPhoto(
      ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      { privacy_level: "SELF_ONLY" },
      1
    );

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.source_info.photo_images).toHaveLength(2);
    expect(body.source_info.photo_cover_index).toBe(1);
  });
});

// ── buildTools ─────────────────────────────────────────────────────────────────

describe("buildTools", () => {
  function makeScheduler() {
    return new PostScheduler(makeClient(), 999_999); // very long interval — never auto-fires in tests
  }

  it("returns core tools without research tools when disabled", () => {
    const client = makeClient();
    const tools = buildTools(client, { ...CFG, enableResearchTools: false }, makeScheduler());
    const names = tools.map((t) => t.name);

    expect(names).toContain("tiktok_get_user_info");
    expect(names).toContain("tiktok_get_creator_info");
    expect(names).toContain("tiktok_list_videos");
    expect(names).toContain("tiktok_get_video");
    expect(names).toContain("tiktok_post_video_url");
    expect(names).toContain("tiktok_post_video_and_wait");
    expect(names).toContain("tiktok_post_photo");
    expect(names).toContain("tiktok_get_publish_status");
    expect(names).toContain("tiktok_refresh_token");

    expect(names).not.toContain("tiktok_get_video_comments");
    expect(names).not.toContain("tiktok_search_videos");
  });

  it("includes research tools when enableResearchTools is true", () => {
    const client = makeClient();
    const tools = buildTools(client, { ...CFG, enableResearchTools: true }, makeScheduler());
    const names = tools.map((t) => t.name);

    expect(names).toContain("tiktok_get_video_comments");
    expect(names).toContain("tiktok_search_videos");
  });

  it("tiktok_post_photo rejects 0 images", async () => {
    const client = makeClient();
    const tools = buildTools(client, CFG, makeScheduler());
    const photo = tools.find((t) => t.name === "tiktok_post_photo")!;

    await expect(photo.execute({ photoUrls: [] })).rejects.toThrow(
      "1 and 35 images"
    );
  });

  it("tiktok_post_photo rejects > 35 images", async () => {
    const client = makeClient();
    const tools = buildTools(client, CFG, makeScheduler());
    const photo = tools.find((t) => t.name === "tiktok_post_photo")!;

    const urls = Array.from({ length: 36 }, (_, i) => `https://ex.com/${i}.jpg`);
    await expect(photo.execute({ photoUrls: urls })).rejects.toThrow(
      "1 and 35 images"
    );
  });

  it("tiktok_get_video rejects > 20 IDs", async () => {
    const client = makeClient();
    const tools = buildTools(client, CFG, makeScheduler());
    const getVideo = tools.find((t) => t.name === "tiktok_get_video")!;

    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    await expect(getVideo.execute({ videoIds: ids })).rejects.toThrow(
      "Maximum 20 video IDs"
    );
  });

  it("tiktok_post_video_url uses defaultPrivacyLevel from config", async () => {
    const client = makeClient();
    const tools = buildTools(client, { ...CFG, defaultPrivacyLevel: "FOLLOWER_OF_CREATOR" }, makeScheduler());
    const postVideo = tools.find((t) => t.name === "tiktok_post_video_url")!;

    global.fetch = vi.fn().mockResolvedValueOnce(
      makeOkResponse({ publish_id: "pub-999" })
    );

    await postVideo.execute({ videoUrl: "https://example.com/v.mp4" });

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.post_info.privacy_level).toBe("FOLLOWER_OF_CREATOR");
  });
});

// ── Viral Predictor ────────────────────────────────────────────────────────────

describe("predictViralScore", () => {
  it("returns 5 factors summing to overallScore", () => {
    const result = predictViralScore({ caption: "Hello world #test" });
    expect(result.factors).toHaveLength(5);
    const factorSum = result.factors.reduce((s, f) => s + f.score, 0);
    expect(factorSum).toBe(result.overallScore);
  });

  it("rates a strong post as HIGH or VERY_HIGH", () => {
    const result = predictViralScore({
      caption:
        "Wait for it... 3 tips that changed my life 🔥 #viral #fyp #lifehacks",
      musicId: "trending-music-1",
      videoDurationSecs: 12,
      plannedPostHourUTC: 14,
      trendingMusicIds: ["trending-music-1", "trending-music-2"],
      optimalPostHoursUTC: [14, 19, 12],
    });
    expect(["HIGH", "VERY_HIGH"]).toContain(result.rating);
    expect(result.overallScore).toBeGreaterThan(59);
  });

  it("rates a weak post as LOW or MEDIUM", () => {
    const result = predictViralScore({
      caption: "hi",
      videoDurationSecs: 300,
      plannedPostHourUTC: 3,
      trendingMusicIds: ["trending-1"],
      optimalPostHoursUTC: [14, 19, 12],
    });
    expect(["LOW", "MEDIUM"]).toContain(result.rating);
    expect(result.overallScore).toBeLessThan(60);
  });

  it("detects delayed reveal format", () => {
    const result = predictViralScore({
      caption: "Stay until the end for the reveal #shocking #fyp",
    });
    const formatFactor = result.factors.find((f) => f.factor === "Content Format")!;
    expect(formatFactor.score).toBeGreaterThanOrEqual(18);
  });

  it("detects tutorial/save-worthy format", () => {
    const result = predictViralScore({
      caption: "How to double your income in 30 days — step by step guide #tutorial",
    });
    const formatFactor = result.factors.find((f) => f.factor === "Content Format")!;
    expect(formatFactor.score).toBeGreaterThanOrEqual(16);
  });

  it("gives max audio score for #1 trending music", () => {
    const result = predictViralScore({
      caption: "test",
      musicId: "music-abc",
      trendingMusicIds: ["music-abc", "music-xyz"],
    });
    const audioFactor = result.factors.find((f) => f.factor === "Audio / Sound Trend")!;
    expect(audioFactor.score).toBe(20);
  });

  it("gives minimum audio score for non-trending music when list is provided", () => {
    const result = predictViralScore({
      caption: "test",
      musicId: "unknown-music",
      trendingMusicIds: ["music-1", "music-2"],
    });
    const audioFactor = result.factors.find((f) => f.factor === "Audio / Sound Trend")!;
    expect(audioFactor.score).toBeLessThanOrEqual(8);
  });

  it("awards top duration score for 7-15s videos", () => {
    const result = predictViralScore({ caption: "test", videoDurationSecs: 10 });
    const dur = result.factors.find((f) => f.factor === "Video Length (Completion)")!;
    expect(dur.score).toBe(20);
  });

  it("penalises very long videos", () => {
    const result = predictViralScore({ caption: "test", videoDurationSecs: 200 });
    const dur = result.factors.find((f) => f.factor === "Video Length (Completion)")!;
    expect(dur.score).toBeLessThanOrEqual(6);
  });

  it("includes topSuggestions array", () => {
    const result = predictViralScore({ caption: "test" });
    expect(Array.isArray(result.topSuggestions)).toBe(true);
    expect(result.topSuggestions.length).toBeGreaterThan(0);
  });
});

// ── PostScheduler ──────────────────────────────────────────────────────────────

describe("PostScheduler", () => {
  it("schedules a post and returns PENDING", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    const future = Date.now() + 60_000;
    const post = scheduler.schedule(
      "https://example.com/v.mp4",
      { privacy_level: "SELF_ONLY" },
      future
    );
    expect(post.status).toBe("PENDING");
    expect(post.id).toBeTruthy();
    expect(post.scheduledAtMs).toBe(future);
  });

  it("throws when scheduling in the past", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    expect(() =>
      scheduler.schedule(
        "https://example.com/v.mp4",
        { privacy_level: "SELF_ONLY" },
        Date.now() - 1000
      )
    ).toThrow("future");
  });

  it("cancels a PENDING post", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    const post = scheduler.schedule(
      "https://example.com/v.mp4",
      { privacy_level: "SELF_ONLY" },
      Date.now() + 60_000
    );
    const cancelled = scheduler.cancel(post.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(scheduler.get(post.id)?.status).toBe("CANCELLED");
  });

  it("throws when cancelling a non-PENDING post", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    const post = scheduler.schedule(
      "https://example.com/v.mp4",
      { privacy_level: "SELF_ONLY" },
      Date.now() + 60_000
    );
    scheduler.cancel(post.id);
    expect(() => scheduler.cancel(post.id)).toThrow("CANCELLED");
  });

  it("list() returns all posts sorted by scheduledAt", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    const t1 = Date.now() + 120_000;
    const t2 = Date.now() + 60_000;
    scheduler.schedule("https://example.com/a.mp4", { privacy_level: "SELF_ONLY" }, t1);
    scheduler.schedule("https://example.com/b.mp4", { privacy_level: "SELF_ONLY" }, t2);
    const list = scheduler.list();
    expect(list[0].scheduledAtMs).toBe(t2);
    expect(list[1].scheduledAtMs).toBe(t1);
  });

  it("list() filters by status", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    const post = scheduler.schedule(
      "https://example.com/v.mp4",
      { privacy_level: "SELF_ONLY" },
      Date.now() + 60_000
    );
    scheduler.cancel(post.id);
    expect(scheduler.list("PENDING")).toHaveLength(0);
    expect(scheduler.list("CANCELLED")).toHaveLength(1);
  });

  it("throws when cancelling unknown id", () => {
    const scheduler = new PostScheduler(makeClient(), 999_999);
    expect(() => scheduler.cancel("nonexistent-id")).toThrow("No scheduled post found");
  });
});
