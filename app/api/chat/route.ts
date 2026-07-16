import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { defaultModel, qualityModel } from "@/lib/ai";

export const maxDuration = 60;

export const POST = async (req: Request): Promise<Response> => {
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

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
};
