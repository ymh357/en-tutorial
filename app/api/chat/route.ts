import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { defaultModel, qualityModel } from "@/lib/ai";

export const maxDuration = 60;

const MAX_BODY_SIZE = 100_000; // ~100KB

// Metadata attached to the final assistant message so the client can read
// real token usage + the model that actually served the request, instead of
// falling back to a char-count estimate. Consumed by the conversation page
// (B2) — this route only needs to surface it.
export type ChatMessageMetadata = {
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export const POST = async (req: Request): Promise<Response> => {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: { messages?: UIMessage[]; system?: string; useQualityModel?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, system, useQualityModel } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages array is required" }, { status: 400 });
  }

  if (system !== undefined && typeof system !== "string") {
    return Response.json({ error: "system must be a string" }, { status: 400 });
  }

  const model = useQualityModel ? qualityModel : defaultModel;

  try {
    const result = streamText({
      model,
      system,
      messages: await convertToModelMessages(messages),
    });

    // Captured from the 'finish-step' stream part, which always fires
    // immediately before 'finish' — gives us the model id the provider
    // actually reported (response.modelId), not just the one requested.
    let respondingModelId: string | undefined;

    return result.toUIMessageStreamResponse<UIMessage<ChatMessageMetadata>>({
      messageMetadata: ({ part }) => {
        if (part.type === "finish-step") {
          respondingModelId = part.response.modelId;
          return undefined;
        }
        if (part.type === "finish") {
          return {
            model: respondingModelId ?? model.modelId,
            usage: {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            },
          };
        }
        return undefined;
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "AI streaming failed" },
      { status: 502 }
    );
  }
};
