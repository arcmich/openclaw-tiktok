/**
 * Viral predictor — scores a planned TikTok post against the 2026 algorithm
 * ranking signals derived from TikTok's published documentation and
 * independent research.
 *
 * Five weighted factors (total 100 pts):
 *   1. Caption & Hook Quality        25 pts  (3-second scroll-stop power)
 *   2. Content Format Strategy       20 pts  (proven viral story structures)
 *   3. Audio / Sound Trend           20 pts  (trending audio = ~2x FYP reach)
 *   4. Video Length → Completion     20 pts  (completion rate is #1 signal)
 *   5. Post Timing                   15 pts  (audience online window)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ViralScoreInput {
  /** Full caption text including hashtags */
  caption: string;
  /** TikTok music ID that will be used on the video (optional) */
  musicId?: string;
  /** Video length in seconds (optional, but strongly affects score) */
  videoDurationSecs?: number;
  /** UTC hour (0–23) you plan to publish (optional) */
  plannedPostHourUTC?: number;
  /**
   * Top music IDs from tiktok_find_trending_audio for this niche.
   * Enables research-backed audio scoring.
   */
  trendingMusicIds?: string[];
  /**
   * Hashtags extracted from recent viral videos in the niche
   * (from tiktok_find_viral_videos or tiktok_search_videos).
   * Enables research-backed hashtag scoring.
   */
  nicheViralHashtags?: string[];
  /**
   * Account-specific best posting hours (from tiktok_find_optimal_post_time).
   * Enables personalised timing score.
   */
  optimalPostHoursUTC?: number[];
}

export interface ViralFactor {
  factor: string;
  score: number;
  maxScore: number;
  percentage: number;
  detail: string;
}

export type ViralRating = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export interface ViralPrediction {
  overallScore: number;       // 0–100
  rating: ViralRating;
  ratingLabel: string;        // e.g. "High Viral Potential 🔥"
  factors: ViralFactor[];
  topSuggestions: string[];   // max 5 actionable improvements
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractHashtags(text: string): string[] {
  return (text.match(/#[\w\u00C0-\u017F]+/g) ?? []).map((h) =>
    h.slice(1).toLowerCase()
  );
}

function emojiCount(text: string): number {
  return [...text].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return (
      (cp >= 0x1f600 && cp <= 0x1f64f) ||
      (cp >= 0x1f300 && cp <= 0x1f5ff) ||
      (cp >= 0x1f680 && cp <= 0x1f6ff) ||
      (cp >= 0x2600 && cp <= 0x26ff) ||
      (cp >= 0x2700 && cp <= 0x27bf)
    );
  }).length;
}

// ── Factor 1: Caption & Hook (25 pts) ────────────────────────────────────────

const HOOK_OPENERS =
  /^(\d+[\s\w]|how to|watch|wait|pov:|this|why|what|the truth|stop|never|always|i tried|i tested|i spent)/i;

function scoreCaptionHook(caption: string): ViralFactor {
  let score = 0;
  const notes: string[] = [];

  // Strong opening hook (+8)
  const firstLine = caption.split("\n")[0].trim();
  if (HOOK_OPENERS.test(firstLine)) {
    score += 8;
    notes.push("strong scroll-stopper opener");
  } else {
    notes.push("opener could be stronger — try a number, POV, or bold claim");
  }

  // Question in caption (+5) — curiosity gap
  if (caption.includes("?")) {
    score += 5;
    notes.push("curiosity-gap question");
  }

  // Emoji usage (+4)
  const ec = emojiCount(caption);
  if (ec >= 1 && ec <= 4) {
    score += 4;
    notes.push(`${ec} emoji(s) — good visual break`);
  } else if (ec > 4) {
    notes.push("too many emojis — reduce to 1-4");
  } else {
    notes.push("add 1-2 emojis for visual breaks");
  }

  // Caption length (+5 at 80-280 chars — shows effort without spam)
  if (caption.length >= 80 && caption.length <= 280) {
    score += 5;
    notes.push("caption length is optimal");
  } else if (caption.length < 40) {
    notes.push("caption too short — add context or keywords");
  } else {
    notes.push("caption very long — algorithm indexes first 100 chars most heavily");
  }

  // Hashtag count (+3 for 3–5 hashtags)
  const tags = extractHashtags(caption);
  if (tags.length >= 3 && tags.length <= 5) {
    score += 3;
    notes.push(`${tags.length} hashtags (sweet spot)`);
  } else if (tags.length > 5) {
    notes.push(`${tags.length} hashtags is too many — cut to 3-5`);
  } else if (tags.length < 2) {
    notes.push("add 3-5 hashtags for keyword indexing");
  }

  return {
    factor: "Caption & Hook",
    score,
    maxScore: 25,
    percentage: Math.round((score / 25) * 100),
    detail: notes.join(" · "),
  };
}

// ── Factor 2: Content Format Strategy (20 pts) ───────────────────────────────

const FORMAT_PATTERNS: Array<{ name: string; pts: number; pattern: RegExp }> = [
  {
    name: "delayed reveal",
    pts: 20,
    pattern: /wait for it|end|until the end|stay for|part \d|to be continued/i,
  },
  {
    name: "save-worthy tutorial",
    pts: 18,
    pattern: /how to|step \d|tip|trick|hack|tutorial|guide|formula|method/i,
  },
  {
    name: "relatable story arc",
    pts: 17,
    pattern: /\bpov\b|story time|when you|me when|this is why|found out|realised|realized/i,
  },
  {
    name: "unexpected comparison",
    pts: 16,
    pattern: /vs\b|versus|difference between|which is|better than|worse than|comparison/i,
  },
  {
    name: "controversy loop",
    pts: 15,
    pattern: /unpopular opinion|hot take|controversial|disagree|fight me|nobody talks about/i,
  },
  {
    name: "reaction / challenge",
    pts: 14,
    pattern: /react|challenge|duet|stitch|respond|replied|told me/i,
  },
];

function scoreContentFormat(caption: string): ViralFactor {
  for (const fmt of FORMAT_PATTERNS) {
    if (fmt.pattern.test(caption)) {
      return {
        factor: "Content Format",
        score: fmt.pts,
        maxScore: 20,
        percentage: Math.round((fmt.pts / 20) * 100),
        detail: `matched "${fmt.name}" format — proven high-retention structure`,
      };
    }
  }
  return {
    factor: "Content Format",
    score: 8,
    maxScore: 20,
    percentage: 40,
    detail:
      "no proven format detected — consider: delayed reveal, tutorial, POV story, " +
      "unexpected comparison, or hot take",
  };
}

// ── Factor 3: Audio / Sound (20 pts) ─────────────────────────────────────────

function scoreAudio(
  musicId: string | undefined,
  trendingMusicIds: string[] | undefined
): ViralFactor {
  if (!musicId) {
    return {
      factor: "Audio / Sound Trend",
      score: 8,
      maxScore: 20,
      percentage: 40,
      detail:
        "no musicId provided — original audio is valid but a trending sound can " +
        "double FYP distribution; run tiktok_find_trending_audio",
    };
  }

  if (!trendingMusicIds || trendingMusicIds.length === 0) {
    return {
      factor: "Audio / Sound Trend",
      score: 12,
      maxScore: 20,
      percentage: 60,
      detail:
        "musicId provided but no trending data — run tiktok_find_trending_audio " +
        "to verify if this sound is gaining velocity",
    };
  }

  const rank = trendingMusicIds.indexOf(musicId);
  if (rank === 0) {
    return {
      factor: "Audio / Sound Trend",
      score: 20,
      maxScore: 20,
      percentage: 100,
      detail: "#1 trending sound in your niche — maximum FYP velocity boost",
    };
  }
  if (rank >= 1 && rank <= 2) {
    return {
      factor: "Audio / Sound Trend",
      score: 18,
      maxScore: 20,
      percentage: 90,
      detail: `top-3 trending sound (#${rank + 1}) — strong FYP signal`,
    };
  }
  if (rank >= 3 && rank <= 9) {
    return {
      factor: "Audio / Sound Trend",
      score: 14,
      maxScore: 20,
      percentage: 70,
      detail: `trending sound (rank #${rank + 1}) — above-average reach`,
    };
  }

  return {
    factor: "Audio / Sound Trend",
    score: 6,
    maxScore: 20,
    percentage: 30,
    detail:
      "audio not in trending list — consider switching to a higher-ranked sound",
  };
}

// ── Factor 4: Video Length → Completion Rate (20 pts) ────────────────────────

function scoreVideoLength(durationSecs: number | undefined): ViralFactor {
  if (durationSecs === undefined) {
    return {
      factor: "Video Length (Completion)",
      score: 10,
      maxScore: 20,
      percentage: 50,
      detail: "provide videoDurationSecs for completion-rate scoring",
    };
  }

  // 2026 completion rate sweet spots (from TikTok algo research)
  const zones: Array<[number, number, number, string]> = [
    [7, 15, 20, "ultra-short (7–15s) — near-100% completion rate, maximum replay loops"],
    [16, 34, 18, "short story (16–34s) — high completion, strong second-batch promotion"],
    [35, 60, 14, "standard (35–60s) — decent completion if hook is strong"],
    [61, 90, 10, "medium (61–90s) — completion risk; ensure strong 3s hook + mid-hook"],
    [91, 180, 6, "long-form (91–180s) — high drop-off; only works with strong story arc"],
    [181, Infinity, 3, "very long (>3min) — completion will likely be low; consider splitting"],
  ];

  for (const [min, max, pts, note] of zones) {
    if (durationSecs >= min && durationSecs <= max) {
      return {
        factor: "Video Length (Completion)",
        score: pts,
        maxScore: 20,
        percentage: Math.round((pts / 20) * 100),
        detail: note,
      };
    }
  }

  // < 7s
  return {
    factor: "Video Length (Completion)",
    score: 5,
    maxScore: 20,
    percentage: 25,
    detail: "very short (<7s) — may not register as a full view play; aim for ≥7s",
  };
}

// ── Factor 5: Post Timing (15 pts) ───────────────────────────────────────────

// Global fallback good hours (UTC) — roughly covers peak US + EU windows
const GLOBAL_GOOD_HOURS = new Set([11, 12, 13, 14, 17, 18, 19, 20, 21, 22]);

function scorePostTiming(
  plannedHourUTC: number | undefined,
  optimalHoursUTC: number[] | undefined
): ViralFactor {
  if (plannedHourUTC === undefined) {
    return {
      factor: "Post Timing",
      score: 7,
      maxScore: 15,
      percentage: 47,
      detail:
        "provide plannedPostHourUTC + run tiktok_find_optimal_post_time for personalised score",
    };
  }

  if (optimalHoursUTC && optimalHoursUTC.length >= 3) {
    const rank = optimalHoursUTC.indexOf(plannedHourUTC);
    if (rank === 0) {
      return {
        factor: "Post Timing",
        score: 15,
        maxScore: 15,
        percentage: 100,
        detail: `${plannedHourUTC}:00 UTC — your #1 best-performing hour`,
      };
    }
    if (rank === 1) {
      return {
        factor: "Post Timing",
        score: 13,
        maxScore: 15,
        percentage: 87,
        detail: `${plannedHourUTC}:00 UTC — your 2nd best hour`,
      };
    }
    if (rank === 2) {
      return {
        factor: "Post Timing",
        score: 11,
        maxScore: 15,
        percentage: 73,
        detail: `${plannedHourUTC}:00 UTC — your 3rd best hour`,
      };
    }
    const best = optimalHoursUTC
      .slice(0, 3)
      .map((h) => `${h}:00 UTC`)
      .join(", ");
    return {
      factor: "Post Timing",
      score: 4,
      maxScore: 15,
      percentage: 27,
      detail: `sub-optimal hour — your best times are: ${best}`,
    };
  }

  // No account data — fall back to global heuristics
  if (GLOBAL_GOOD_HOURS.has(plannedHourUTC)) {
    return {
      factor: "Post Timing",
      score: 10,
      maxScore: 15,
      percentage: 67,
      detail: `${plannedHourUTC}:00 UTC is generally a strong posting window`,
    };
  }
  return {
    factor: "Post Timing",
    score: 4,
    maxScore: 15,
    percentage: 27,
    detail: `${plannedHourUTC}:00 UTC is outside peak windows — run tiktok_find_optimal_post_time`,
  };
}

// ── Rating ────────────────────────────────────────────────────────────────────

function rateScore(score: number): { rating: ViralRating; ratingLabel: string } {
  if (score >= 80) return { rating: "VERY_HIGH", ratingLabel: "Very High Viral Potential 🔥" };
  if (score >= 60) return { rating: "HIGH", ratingLabel: "High Viral Potential ⚡" };
  if (score >= 40) return { rating: "MEDIUM", ratingLabel: "Moderate Viral Potential 📈" };
  return { rating: "LOW", ratingLabel: "Low Viral Potential 🧊" };
}

// ── Suggestions ───────────────────────────────────────────────────────────────

function buildSuggestions(factors: ViralFactor[], input: ViralScoreInput): string[] {
  const suggestions: string[] = [];

  const hook = factors.find((f) => f.factor === "Caption & Hook")!;
  if (hook.score < 15) {
    suggestions.push(
      "Rewrite the first line as a scroll-stopper: use a bold number (\"3 things...\"), " +
        "a POV opener, or an open loop that forces viewers to watch to the end."
    );
  }

  const format = factors.find((f) => f.factor === "Content Format")!;
  if (format.score < 14) {
    suggestions.push(
      "Structure your video as a delayed reveal or save-worthy tutorial — these are " +
        "the two formats with the highest FYP distribution rates in 2026."
    );
  }

  const audio = factors.find((f) => f.factor === "Audio / Sound Trend")!;
  if (audio.score < 14) {
    if (!input.musicId) {
      suggestions.push(
        "Run tiktok_find_trending_audio for your niche and overlay a trending sound — " +
          "trending audio can double your FYP reach."
      );
    } else {
      suggestions.push(
        "Your current audio is not trending. Run tiktok_find_trending_audio and swap " +
          "to the #1 or #2 trending sound in your niche."
      );
    }
  }

  const length = factors.find((f) => f.factor === "Video Length (Completion)")!;
  if (length.score < 12 && input.videoDurationSecs !== undefined && input.videoDurationSecs > 60) {
    suggestions.push(
      `Your video is ${input.videoDurationSecs}s — completion rate drops sharply above 60s. ` +
        "Edit to 21-34s for the highest completion/views ratio, or add a mid-hook at 15s " +
        "to reset drop-off."
    );
  }

  const timing = factors.find((f) => f.factor === "Post Timing")!;
  if (timing.score < 10) {
    suggestions.push(
      "Run tiktok_find_optimal_post_time to find your account's peak hours, then use " +
        "tiktok_schedule_post to queue this video for that exact window."
    );
  }

  return suggestions.slice(0, 5);
}

// ── Main export ───────────────────────────────────────────────────────────────

export function predictViralScore(input: ViralScoreInput): ViralPrediction {
  const factors: ViralFactor[] = [
    scoreCaptionHook(input.caption),
    scoreContentFormat(input.caption),
    scoreAudio(input.musicId, input.trendingMusicIds),
    scoreVideoLength(input.videoDurationSecs),
    scorePostTiming(input.plannedPostHourUTC, input.optimalPostHoursUTC),
  ];

  const total = factors.reduce((s, f) => s + f.score, 0);
  const { rating, ratingLabel } = rateScore(total);
  const suggestions = buildSuggestions(factors, input);

  const lowestFactor = [...factors].sort((a, b) => a.percentage - b.percentage)[0];
  const summary =
    `Score: ${total}/100 — ${ratingLabel}. ` +
    `Biggest opportunity: "${lowestFactor.factor}" (${lowestFactor.percentage}%). ` +
    (suggestions[0] ?? "");

  return { overallScore: total, rating, ratingLabel, factors, topSuggestions: suggestions, summary };
}
