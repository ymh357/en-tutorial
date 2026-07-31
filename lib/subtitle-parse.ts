// Unified subtitle parsing for authentic listening materials (W4-T2 audio /
// W4-T3 video). Normalizes srt/vtt/json3 into MaterialSentence[] so the
// listening pipeline can drive per-sentence seek/loop from a single shape.
//
// json3 is YouTube's native format (also what the yt-dlp Python function in
// W4-T3 returns). srt/vtt cover user-uploaded subtitle files for W4-T2 audio.
//
// The youtube-captions TS route (pure-fetch, 2026-07-30) was deleted after the
// POT probe proved pure fetch returns an empty timedtext body; its parseJson3
// logic lives on here, shared by both W4 tasks.

import type { MaterialSentence } from "./types";

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

interface Json3 {
  events?: Json3Event[];
}

// Drop YouTube's non-speech markers like [Music], [Applause], ♪♪♪ so sentences
// are real spoken text usable for listening practice.
const SPEECH_ONLY = /^[\[\(]/;
const isSpeech = (text: string): boolean =>
  text.length > 0 && !SPEECH_ONLY.test(text);

const toSentence = (
  text: string,
  startMs: number,
  endMs: number
): MaterialSentence => ({
  text,
  audioStartMs: startMs,
  audioEndMs: Number.isFinite(endMs) && endMs > startMs ? endMs : undefined,
});

/** Parse YouTube json3 captions into MaterialSentence[]. */
export const parseJson3 = (data: unknown): MaterialSentence[] => {
  const events = (data as Json3)?.events ?? [];
  const out: MaterialSentence[] = [];
  for (const ev of events) {
    if (ev.tStartMs == null) continue;
    const text = (ev.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (!isSpeech(text)) continue;
    out.push(toSentence(text, ev.tStartMs, ev.tStartMs + (ev.dDurationMs ?? 0)));
  }
  return out;
};

// `HH:MM:SS,mmm` (srt) or `HH:MM:SS.mmm` (vtt). Returns milliseconds.
const parseTimestamp = (ts: string): number => {
  const m = ts.match(
    /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/
  );
  if (!m) return 0;
  const [, h, mm, ss, ms] = m;
  return (
    (Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 +
    Number(ms.padEnd(3, "0"))
  );
};

// Shared block parser for srt/vtt: each block is a "start --> end" cue line
// followed by one or more text lines.
const parseCueBlocks = (content: string): MaterialSentence[] => {
  const out: MaterialSentence[] = [];
  // Normalize line endings; strip vtt "WEBVTT" header and NOTE blocks.
  const body = content.replace(/\r/g, "").replace(/^WEBVTT.*\n/i, "");
  const blocks = body.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const cueIdx = lines.findIndex((l) => l.includes("-->"));
    if (cueIdx === -1) continue;
    const [startStr, endStr] = lines[cueIdx].split("-->");
    const startMs = parseTimestamp(startStr.trim());
    // endStr may carry a leading space (from "start --> end"); trim before
    // splitting off any trailing cue settings, otherwise split(/\s/)[0] hits
    // the leading space and yields "" → endMs 0 → audioEndMs dropped (which
    // silently broke per-sentence playback bounds for every srt/vtt material).
    const endMs = parseTimestamp((endStr ?? "").trim().split(/\s/)[0]);
    const text = lines
      .slice(cueIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip vtt inline tags like <c.colorE5E5E5>
      .trim();
    if (!isSpeech(text)) continue;
    out.push(toSentence(text, startMs, endMs));
  }
  return out;
};

/** Parse SubRip (.srt) captions into MaterialSentence[]. */
export const parseSrt = (content: string): MaterialSentence[] =>
  parseCueBlocks(content);

/** Parse WebVTT (.vtt) captions into MaterialSentence[]. */
export const parseVtt = (content: string): MaterialSentence[] =>
  parseCueBlocks(content);

// Bilibili subtitle JSON: { body: [{ from, to, content }, ...] } in seconds.
// Normalize to MaterialSentence with ms timestamps via the shared toSentence.
export const parseBilibili = (data: unknown): MaterialSentence[] => {
  const body = (data as { body?: { from?: number; to?: number; content?: string }[] } | null)
    ?.body;
  if (!Array.isArray(body)) return [];
  return body
    .filter((s) => s && typeof s.content === "string" && s.content.trim().length > 0)
    .map((s) =>
      toSentence(s.content!.trim(), (s.from ?? 0) * 1000, (s.to ?? 0) * 1000)
    );
};

/** Detect format by content and parse accordingly. */
export const parseSubtitles = (content: string): MaterialSentence[] => {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") && trimmed.includes('"events"')) {
    try {
      return parseJson3(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (trimmed.startsWith("WEBVTT")) return parseVtt(content);
  // srt blocks start with a cue index number; fall back to srt parser.
  return parseSrt(content);
};
