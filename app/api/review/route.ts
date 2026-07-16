import { generateText } from "ai";
import { qualityModel } from "@/lib/ai";

export const maxDuration = 120;

export const POST = async (req: Request): Promise<Response> => {
  const { prompt, system }: { prompt: string; system?: string } =
    await req.json();

  const result = await generateText({
    model: qualityModel,
    system,
    prompt,
  });

  return Response.json({ content: result.text });
};
