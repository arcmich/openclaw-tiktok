import { definePluginEntry } from "openclaw/plugin-sdk";
import { TokenManager } from "./token-manager.js";
import { TikTokApiClient } from "./api-client.js";
import { buildTools } from "./tools.js";
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

    const tools = buildTools(client, cfg);
    for (const tool of tools) {
      api.registerTool(tool);
    }
  },
});
