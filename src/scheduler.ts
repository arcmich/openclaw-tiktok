import crypto from "node:crypto";
import type { TikTokApiClient } from "./api-client.js";
import type { PostInfo } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScheduledPostStatus =
  | "PENDING"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED";

export interface ScheduledPost {
  id: string;
  videoUrl: string;
  postInfo: PostInfo;
  scheduledAtMs: number;    // epoch ms — when to publish
  createdAtMs: number;
  status: ScheduledPostStatus;
  publishId?: string;       // TikTok publish_id once submitted
  postIds?: string[];       // TikTok video IDs once live
  error?: string;
  completedAtMs?: number;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * In-process post scheduler.
 *
 * Maintains a Map of scheduled posts and checks for due items every
 * `checkIntervalMs` (default 30 s). When a post is due it is submitted to
 * TikTok's Content Posting API and polled until PUBLISH_COMPLETE or FAILED.
 *
 * State is in-memory only — posts survive for the lifetime of the Gateway
 * process. For persistent scheduling, mount a database-backed store via the
 * `load` / `save` hooks (not implemented here).
 */
export class PostScheduler {
  private readonly queue = new Map<string, ScheduledPost>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: TikTokApiClient,
    private readonly checkIntervalMs = 30_000
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  schedule(
    videoUrl: string,
    postInfo: PostInfo,
    scheduledAtMs: number
  ): ScheduledPost {
    if (scheduledAtMs <= Date.now()) {
      throw new Error(
        "scheduledAt must be in the future. Use tiktok_post_growth_optimized " +
          "or tiktok_post_video_url to post immediately."
      );
    }

    const post: ScheduledPost = {
      id: crypto.randomUUID(),
      videoUrl,
      postInfo,
      scheduledAtMs,
      createdAtMs: Date.now(),
      status: "PENDING",
    };

    this.queue.set(post.id, post);
    return post;
  }

  cancel(id: string): ScheduledPost {
    const post = this.queue.get(id);
    if (!post) throw new Error(`No scheduled post found with id: ${id}`);
    if (post.status !== "PENDING") {
      throw new Error(
        `Cannot cancel post ${id} — current status is "${post.status}". ` +
          "Only PENDING posts can be cancelled."
      );
    }
    post.status = "CANCELLED";
    return post;
  }

  get(id: string): ScheduledPost | undefined {
    return this.queue.get(id);
  }

  list(statusFilter?: ScheduledPostStatus): ScheduledPost[] {
    const all = [...this.queue.values()].sort(
      (a, b) => a.scheduledAtMs - b.scheduledAtMs
    );
    return statusFilter ? all.filter((p) => p.status === statusFilter) : all;
  }

  // ── Service lifecycle ────────────────────────────────────────────────────────

  start(): () => void {
    if (this.timer) return () => this.stop();
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── Internal tick ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = Date.now();
    const due = [...this.queue.values()].filter(
      (p) => p.status === "PENDING" && p.scheduledAtMs <= now
    );

    for (const post of due) {
      await this.publishPost(post);
    }
  }

  private async publishPost(post: ScheduledPost): Promise<void> {
    post.status = "PUBLISHING";

    try {
      const init = await this.client.publishVideoFromUrl(
        post.videoUrl,
        post.postInfo
      );
      post.publishId = init.publish_id;

      const result = await this.client.waitForPublish(init.publish_id);

      if (result.status === "PUBLISH_COMPLETE") {
        post.status = "PUBLISHED";
        post.postIds = result.publicly_available_post_id ?? [];
      } else {
        post.status = "FAILED";
        post.error = result.fail_reason ?? "TikTok returned FAILED with no reason";
      }
    } catch (err) {
      post.status = "FAILED";
      post.error = err instanceof Error ? err.message : String(err);
    }

    post.completedAtMs = Date.now();
  }
}
