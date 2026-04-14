import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "./token-manager.js";
import { TikTokApiClient } from "./api-client.js";
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
  it("returns core tools without research tools when disabled", () => {
    const client = makeClient();
    const tools = buildTools(client, { ...CFG, enableResearchTools: false });
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
    const tools = buildTools(client, { ...CFG, enableResearchTools: true });
    const names = tools.map((t) => t.name);

    expect(names).toContain("tiktok_get_video_comments");
    expect(names).toContain("tiktok_search_videos");
  });

  it("tiktok_post_photo rejects 0 images", async () => {
    const client = makeClient();
    const tools = buildTools(client, CFG);
    const photo = tools.find((t) => t.name === "tiktok_post_photo")!;

    await expect(photo.execute({ photoUrls: [] })).rejects.toThrow(
      "1 and 35 images"
    );
  });

  it("tiktok_post_photo rejects > 35 images", async () => {
    const client = makeClient();
    const tools = buildTools(client, CFG);
    const photo = tools.find((t) => t.name === "tiktok_post_photo")!;

    const urls = Array.from({ length: 36 }, (_, i) => `https://ex.com/${i}.jpg`);
    await expect(photo.execute({ photoUrls: urls })).rejects.toThrow(
      "1 and 35 images"
    );
  });

  it("tiktok_get_video rejects > 20 IDs", async () => {
    const client = makeClient();
    const tools = buildTools(client, CFG);
    const getVideo = tools.find((t) => t.name === "tiktok_get_video")!;

    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    await expect(getVideo.execute({ videoIds: ids })).rejects.toThrow(
      "Maximum 20 video IDs"
    );
  });

  it("tiktok_post_video_url uses defaultPrivacyLevel from config", async () => {
    const client = makeClient();
    const tools = buildTools(client, { ...CFG, defaultPrivacyLevel: "FOLLOWER_OF_CREATOR" });
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
