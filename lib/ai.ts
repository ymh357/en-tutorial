import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Smoke-tested manually against the router (curl, response_format:
// json_schema) with an adversarial probe: a prompt about favorite colors
// paired with a schema constraining the output to one of three nonsense enum
// values unrelated to color. The model's own reasoning_content stayed on
// topic (colors), yet the final `content` strictly matched the schema's
// enum — proof the router enforces the schema server-side rather than the
// AI SDK's prompt-injection fallback getting lucky. Re-confirmed for BOTH
// deepseek-v4-pro and deepseek-v4-flash via router-api-staging.0g.ai (the
// base URL .env.local currently points at). Plain chat/completions requests
// also confirm the response body's `model` field comes back as exactly
// "deepseek-v4-pro" / "deepseek-v4-flash" (no suffix/version) for both
// models — matching lib/cost-tracker.ts's MODEL_PRICING keys directly, no
// normalization needed.
//
// The default baseURL above is PRODUCTION (router-api.0g.ai), which has NOT
// been independently verified to honor native json_schema mode — only
// STAGING has been tested (see above). Left at `true`, generateObject would
// use native mode on production and hard-error (instead of degrading) if
// production doesn't support it. So this stays `false` for now: with
// `false`, generateObject falls back to injecting the schema into the
// prompt and validates/repairs the result SDK-side — strictly better than
// the old manual fence-strip, and works regardless of native support.
// Now gated behind OG_NATIVE_JSON_SCHEMA: set it to "1" once the target
// router is confirmed to honor native json_schema mode (staging IS confirmed,
// per the smoke test above; production has not been). With native mode,
// generateObject sends response_format instead of injecting the schema into
// the prompt + repairing SDK-side -- fewer input tokens and no repair
// round-trip. Defaults to off so an unverified production endpoint degrades
// gracefully rather than hard-erroring.
const og = createOpenAICompatible({
  name: "0g",
  baseURL: process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1",
  apiKey: process.env.OG_API_KEY ?? "",
  supportsStructuredOutputs: process.env.OG_NATIVE_JSON_SCHEMA === "1",
});

export const defaultModel = og(
  process.env.OG_DEFAULT_MODEL ?? "deepseek-v4-flash"
);

export const qualityModel = og(
  process.env.OG_QUALITY_MODEL ?? "deepseek-v4-pro"
);
