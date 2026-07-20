import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Smoke-tested manually against the router (curl, response_format:
// json_schema) with an adversarial probe: a prompt about favorite colors
// paired with a schema constraining the output to one of three nonsense enum
// values unrelated to color. The model's own reasoning_content stayed on
// topic (colors), yet the final `content` strictly matched the schema's
// enum — proof the router enforces the schema server-side rather than the
// AI SDK's prompt-injection fallback getting lucky. Confirms native
// structured-output support for deepseek-v4-pro via router-api-staging.0g.ai;
// assumed to hold for the production router (same vendor/router codebase) and
// for deepseek-v4-flash, but that specific pairing was not independently
// re-tested.
const og = createOpenAICompatible({
  name: "0g",
  baseURL: process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1",
  apiKey: process.env.OG_API_KEY ?? "",
  supportsStructuredOutputs: true,
});

export const defaultModel = og(
  process.env.OG_DEFAULT_MODEL ?? "deepseek-v4-flash"
);

export const qualityModel = og(
  process.env.OG_QUALITY_MODEL ?? "deepseek-v4-pro"
);
