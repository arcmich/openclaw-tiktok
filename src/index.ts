import { definePluginEntry } from "openclaw/plugin-sdk";
import { TokenManager } from "./token-manager.js";
import { TikTokApiClient } from "./api-client.js";
import { buildTools } from "./tools.js";
import { PostScheduler } from "./scheduler.js";
import { ConfigSchema, type Config } from "./config-schema.js";

export default definePluginEntry({
  id: "tiktok",
  name: "TikTok",
  configSchema: ConfigSchema,

  register(api) {
    const cfg = api.config as Config;

    const tokens = new TokenManager(cfg);

    const client = new TikTokApiClient(
      tokens,
      cfg.pollIntervalMs ?? 3000,
      cfg.pollTimeoutMs ?? 120_000
    );

    // Scheduler runs as a background service — checks for due posts every 30s
    const scheduler = new PostScheduler(client);

    api.registerService({
      id: "tiktok-scheduler",
      start: () => scheduler.start(),
    });

    const tools = buildTools(client, cfg, scheduler);
    for (const tool of tools) {
      api.registerTool(tool);
    }
  },
});
