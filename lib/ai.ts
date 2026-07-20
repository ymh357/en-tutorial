import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Smoke-tested manually against the router (curl, response_format:
// json_schema) with an adversarial probe: a prompt about favorite colors
// paired with a schema constraining the output to one of three nonsense enum
// values unrelated to color. The model's own reasoning_content stayed on
// topic (colors), yet the final `content` strictly matched the schema's
// enum — proof the router enforces the schema server-side rather than the
// AI SDK's prompt-injection fallback getting lucky. Confirms native
// structured-output support for deepseek-v4-pro via router-api-staging.0g.ai.
//
// The default baseURL above is PRODUCTION (router-api.0g.ai), which has NOT
// been independently verified to honor native json_schema mode. Left at
// `true`, generateObject would use native mode there and hard-error (instead
// of degrading) if production doesn't support it. So this stays `false` for
// now: with `false`, generateObject falls back to injecting the schema into
// the prompt and validates/repairs the result SDK-side — strictly better
// than the old manual fence-strip, and works regardless of native support.
// Flip to `true` only after a production smoke test confirms native
// json_schema support there too (optionally gate behind an env var, e.g.
// `OG_NATIVE_JSON_SCHEMA === "1"`, if a toggle without a code change is
// wanted).
const og = createOpenAICompatible({
  name: "0g",
  baseURL: process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1",
  apiKey: process.env.OG_API_KEY ?? "",
  supportsStructuredOutputs: false,
});

export const defaultModel = og(
  process.env.OG_DEFAULT_MODEL ?? "deepseek-v4-flash"
);

export const qualityModel = og(
  process.env.OG_QUALITY_MODEL ?? "deepseek-v4-pro"
);
