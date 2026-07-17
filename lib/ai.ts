import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const og = createOpenAICompatible({
  name: "0g",
  baseURL: process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1",
  apiKey: process.env.OG_API_KEY ?? "",
});

export const defaultModel = og(
  process.env.OG_DEFAULT_MODEL ?? "deepseek-v4-flash"
);

export const qualityModel = og(
  process.env.OG_QUALITY_MODEL ?? "deepseek-v4-pro"
);
