import { generateObject, generateText, jsonSchema } from "ai";
import { qualityModel } from "@/lib/ai";

export const maxDuration = 120;

const MAX_BODY_SIZE = 100_000; // ~100KB

export const POST = async (req: Request): Promise<Response> => {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: {
    prompt?: string;
    system?: string;
    schema?: Record<string, unknown>;
    temperature?: number;
    maxOutputTokens?: number;
    disableThinking?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { prompt, system, schema, temperature, maxOutputTokens, disableThinking } = body;

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt string is required" }, { status: 400 });
  }

  if (system !== undefined && typeof system !== "string") {
    return Response.json({ error: "system must be a string" }, { status: 400 });
  }

  if (schema !== undefined && (typeof schema !== "object" || schema === null)) {
    return Response.json(
      { error: "schema must be a JSON Schema object" },
      { status: 400 }
    );
  }

  if (temperature !== undefined && typeof temperature !== "number") {
    return Response.json({ error: "temperature must be a number" }, { status: 400 });
  }

  if (maxOutputTokens !== undefined && typeof maxOutputTokens !== "number") {
    return Response.json(
      { error: "maxOutputTokens must be a number" },
      { status: 400 }
    );
  }

  if (disableThinking !== undefined && typeof disableThinking !== "boolean") {
    return Response.json(
      { error: "disableThinking must be a boolean" },
      { status: 400 }
    );
  }

  // DeepSeek V4 runs a reasoning pass by default. Callers that pass
  // disableThinking turn it off via the 0g router's enable_thinking flag: it
  // cuts the bulk of the latency (a small structured request drops from ~4.5s
  // to ~2s in testing). For pure scoring/extraction that's a free win. It is
  // ALSO applied to the writing-round2 and translate reviews, which produce a
  // polishedVersion rewrite -- a deliberate speed-over-rewrite-quality
  // tradeoff, chosen knowingly, not a lossless one. Left ON for open-ended
  // creative generation (e.g. article writing), where reasoning helps most.
  // The providerOptions key must match createOpenAICompatible({ name: "0g" }).
  const providerOptions = disableThinking
    ? { "0g": { enable_thinking: false } }
    : undefined;

  try {
    // Structured-output path: caller supplied a JSON Schema (converted from a
    // lib/ai-schemas.ts zod schema on the client). Requests without `schema`
    // fall through to the legacy generateText path below unchanged, so
    // not-yet-migrated callers keep working exactly as before.
    if (schema) {
      const { object, usage, response } = await generateObject({
        model: qualityModel,
        schema: jsonSchema(schema),
        system,
        prompt,
        temperature: temperature ?? 0,
        maxOutputTokens: maxOutputTokens ?? 4096,
        providerOptions,
      });

      return Response.json({
        object,
        usage: {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
        },
        model: response.modelId,
      });
    }

    // No maxOutputTokens cap here: this is the legacy path every current
    // consumer still uses (none pass a schema yet), and some of them produce
    // large output (full round2 polishedVersion rewrites, full reader
    // articles, long conversation reviews). The old route never sent
    // max_tokens either, so leaving it unset preserves that behavior and lets
    // the provider default (higher than any cap we'd pick) apply.
    const { text, usage, response } = await generateText({
      model: qualityModel,
      system,
      prompt,
      maxOutputTokens,
      providerOptions,
    });

    return Response.json({
      content: text,
      // Field names kept as promptTokens/completionTokens (not the AI SDK's
      // own inputTokens/outputTokens) for backward compatibility: every
      // unmigrated consumer today destructures `data.usage.promptTokens` /
      // `data.usage.completionTokens` from this exact response shape. The new
      // schema-based branch above uses the normalized { inputTokens,
      // outputTokens } shape instead, since B2 will build its recordCost
      // mapping for that path fresh, with no legacy readers to break.
      usage: {
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      },
      model: response.modelId,
    });
  } catch (error) {
    console.error("Review API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "AI generation failed" },
      { status: 502 }
    );
  }
};
