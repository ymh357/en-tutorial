import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { defaultModel, qualityModel } from "@/lib/ai";

export const maxDuration = 60;

export const POST = async (req: Request): Promise<Response> => {
  const {
    messages,
    system,
    useQualityModel,
  }: { messages: UIMessage[]; system?: string; useQualityModel?: boolean } =
    await req.json();

  const model = useQualityModel ? qualityModel : defaultModel;

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
};
