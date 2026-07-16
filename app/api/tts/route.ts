import { EdgeTTS } from "edge-tts-universal";

export const maxDuration = 30;

const MAX_TEXT_LENGTH = 5000;

export const POST = async (req: Request): Promise<Response> => {
  let body: { text?: string; rate?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { text, rate } = body;
  if (!text || typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    return Response.json(
      { error: `text required (max ${MAX_TEXT_LENGTH} chars)` },
      { status: 400 }
    );
  }

  if (rate !== undefined && typeof rate !== "string") {
    return Response.json({ error: "rate must be a string" }, { status: 400 });
  }

  try {
    const tts = new EdgeTTS(text, "en-US-AriaNeural", {
      rate: rate || "+0%",
      volume: "+0%",
      pitch: "+0Hz",
    });
    const result = await tts.synthesize();

    const arrayBuffer = await result.audio.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return Response.json({ error: "TTS synthesis failed" }, { status: 500 });
  }
};
