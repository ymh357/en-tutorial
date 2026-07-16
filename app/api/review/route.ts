import { generateText } from "ai";
import { qualityModel } from "@/lib/ai";

export const maxDuration = 120;

export const POST = async (req: Request): Promise<Response> => {
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

  const result = await generateText({
    model: qualityModel,
    system,
    prompt,
  });

  return Response.json({ content: result.text });
};
