import { generateText } from "ai";
import { qualityModel } from "@/lib/ai";

export const maxDuration = 120;

const MAX_BODY_SIZE = 100_000; // ~100KB

export const POST = async (req: Request): Promise<Response> => {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: { prompt?: string; system?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { prompt, system } = body;

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt string is required" }, { status: 400 });
  }

  if (system !== undefined && typeof system !== "string") {
    return Response.json({ error: "system must be a string" }, { status: 400 });
  }

  try {
    const result = await generateText({
      model: qualityModel,
      system,
      prompt,
    });

    return Response.json({
      content: result.text,
      usage: {
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
      },
    });
  } catch (error) {
    console.error("Review API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "AI generation failed" },
      { status: 502 }
    );
  }
};
