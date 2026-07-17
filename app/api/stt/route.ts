export const maxDuration = 30;

export const POST = async (req: Request): Promise<Response> => {
  const formData = await req.formData();
  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof Blob)) {
    return Response.json({ error: "audio file required" }, { status: 400 });
  }

  // Determine the correct file extension from the blob's MIME type.
  // MediaRecorder typically produces audio/webm or audio/ogg depending
  // on the browser. The client may also send a pre-converted WAV.
  const mime = audioFile.type || "audio/webm";
  const extMap: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/flac": "flac",
  };
  const ext = extMap[mime] ?? "webm";

  // Forward to 0G Whisper API
  const apiFormData = new FormData();
  apiFormData.append("file", audioFile, `recording.${ext}`);
  apiFormData.append("model", "whisper-large-v3");
  apiFormData.append("language", "en");
  apiFormData.append("response_format", "json");

  try {
    const res = await fetch(
      `${process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1"}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OG_API_KEY}`,
        },
        body: apiFormData,
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return Response.json(
        { error: `Whisper API error: ${res.status}`, detail: errText },
        { status: 502 }
      );
    }

    const data = await res.json();
    return Response.json({ text: data.text ?? "" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "STT failed" },
      { status: 500 }
    );
  }
};
