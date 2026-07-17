export const maxDuration = 30;

export const POST = async (req: Request): Promise<Response> => {
  const formData = await req.formData();
  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof Blob)) {
    return Response.json({ error: "audio file required" }, { status: 400 });
  }

  // Forward to 0G Whisper API
  const apiFormData = new FormData();
  apiFormData.append("file", audioFile, "recording.webm");
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
