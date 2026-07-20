export const maxDuration = 30;

// Serverless request bodies aren't guarded by any proxy config in this repo
// (see app/api/stt/route.ts investigation notes); enforce a sane ceiling
// ourselves rather than relying on the hosting platform's default.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB

// Segment-level confidence fields returned by 0G's whisper-large-v3 when
// response_format is "verbose_json". Confirmed via manual smoke-test
// (see report): word-level timestamps/confidence are NOT populated (the
// upstream "words" field comes back null even with
// timestamp_granularities[]=word), only per-segment avg_logprob /
// no_speech_prob / compression_ratio.
interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number | null;
  compression_ratio: number;
}

interface WhisperJsonResponse {
  text?: string;
}

interface WhisperVerboseJsonResponse {
  text?: string;
  language?: string;
  duration?: string;
  segments?: WhisperSegment[];
}

interface SttSegment {
  text: string;
  start: number;
  end: number;
  avgLogprob: number;
  noSpeechProb: number | null;
}

export const POST = async (req: Request): Promise<Response> => {
  const apiKey = process.env.OG_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "STT not configured" }, { status: 500 });
  }

  const formData = await req.formData();
  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof Blob)) {
    return Response.json({ error: "audio file required" }, { status: 400 });
  }

  if (audioFile.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: `audio file too large (max ${MAX_AUDIO_BYTES / (1024 * 1024)}MB)` },
      { status: 413 }
    );
  }

  const languageRaw = formData.get("language");
  const language =
    typeof languageRaw === "string" && languageRaw.trim() ? languageRaw.trim() : "en";

  const verboseRaw = formData.get("verbose");
  const verbose = verboseRaw === "true" || verboseRaw === "1";

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
  apiFormData.append("language", language);
  apiFormData.append("response_format", verbose ? "verbose_json" : "json");
  // Prompt guides Whisper toward faithful transcription of non-native speech,
  // preserving grammatical errors rather than auto-correcting them.
  apiFormData.append(
    "prompt",
    "Transcribe exactly what the speaker says, including any grammar mistakes, hesitations, or mispronunciations. Do not correct or rephrase. This is a non-native English speaker practicing conversation."
  );

  try {
    const res = await fetch(
      `${process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1"}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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

    if (verbose) {
      const data = (await res.json()) as WhisperVerboseJsonResponse;
      const segments: SttSegment[] = (data.segments ?? []).map((s) => ({
        text: s.text,
        start: s.start,
        end: s.end,
        avgLogprob: s.avg_logprob,
        noSpeechProb: s.no_speech_prob,
      }));
      return Response.json({
        text: data.text ?? "",
        language: data.language,
        duration: data.duration ? Number(data.duration) : undefined,
        segments,
      });
    }

    const data = (await res.json()) as WhisperJsonResponse;
    return Response.json({ text: data.text ?? "" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "STT failed" },
      { status: 500 }
    );
  }
};
