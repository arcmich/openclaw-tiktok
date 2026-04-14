// ─── TikTok API v2 response shapes ───────────────────────────────────────────

export interface TikTokApiResponse<T = Record<string, unknown>> {
  data: T;
  error: TikTokApiError;
}

export interface TikTokApiError {
  code: string;       // "ok" on success
  message: string;
  log_id: string;
}

// ── User ──────────────────────────────────────────────────────────────────────

export interface TikTokUser {
  open_id: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
}

// ── Video ─────────────────────────────────────────────────────────────────────

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export interface TikTokVideo {
  id: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  embed_link?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  create_time?: number;
  privacy_level?: PrivacyLevel;
}

export interface VideoListResponse {
  videos: TikTokVideo[];
  cursor: number;
  has_more: boolean;
}

// ── Content Posting ───────────────────────────────────────────────────────────

export interface CreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: PrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export interface PostInfo {
  title?: string;
  privacy_level: PrivacyLevel;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  disable_comment?: boolean;
  video_cover_timestamp_ms?: number;
  brand_content_toggle?: boolean;
  brand_organic_toggle?: boolean;
  is_aigc?: boolean;
}

export interface PublishInitResponse {
  publish_id: string;
  upload_url?: string; // present for FILE_UPLOAD only
}

export type PublishStatus =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export interface PublishStatusResponse {
  publish_id: string;
  status: PublishStatus;
  fail_reason?: string;
  publicly_available_post_id?: string[];
  uploaded_bytes?: number;
}

// ── Research (comments, search) ───────────────────────────────────────────────

export interface TikTokComment {
  id: string;
  text?: string;
  like_count?: number;
  reply_count?: number;
  parent_comment_id?: string;
  create_time?: number;
}

export interface CommentListResponse {
  comments: TikTokComment[];
  cursor: number;
  has_more: boolean;
  total_count?: number;
}

export interface ResearchVideo {
  id: string;
  video_description?: string;
  create_time?: number;
  region_code?: string;
  share_count?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  music_id?: string;
  hashtag_names?: string[];
  username?: string;
  effect_ids?: string[];
  voice_to_text?: string;
}

export interface ResearchVideoResponse {
  videos: ResearchVideo[];
  cursor: number;
  has_more: boolean;
  search_id: string;
}

// ── OAuth token ───────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  token_type: string;
  scope: string;
  open_id: string;
}
