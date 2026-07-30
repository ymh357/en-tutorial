import { EdgeTTS } from "edge-tts-universal";

export const maxDuration = 30;

const MAX_TEXT_LENGTH = 5000;

export const POST = async (req: Request): Promise<Response> => {
  let body: { text?: string; rate?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { text, rate, voice } = body;
  if (!text || typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    return Response.json(
      { error: `text required (max ${MAX_TEXT_LENGTH} chars)` },
      { status: 400 }
    );
  }

  if (rate !== undefined && typeof rate !== "string") {
    return Response.json({ error: "rate must be a string" }, { status: 400 });
  }
  if (voice !== undefined && typeof voice !== "string") {
    return Response.json({ error: "voice must be a string" }, { status: 400 });
  }

  // Default to en-US-AriaNeural. Caller may pass any Edge-TTS voice id (e.g.
  // en-GB-LibbyNeural, en-AU-NatashaNeural, en-IN-NeerjaNeural) for accent
  // training (methodology).
  const voiceId = voice || "en-US-AriaNeural";

  try {
    const tts = new EdgeTTS(text, voiceId, {
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
