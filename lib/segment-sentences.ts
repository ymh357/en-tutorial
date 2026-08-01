// LLM sentence segmentation for YouTube json3 auto-captions.
//
// YouTube ASR json3 events are phrase-level chunks (1-5s, no terminal
// punctuation) — one-event-per-sentence (parseJson3) leaves fragments, so the
// listening AB-loop反复 on half-sentences. This module re-groups events into
// complete spoken sentences.
//
// Approach (v2): ask the LLM to return segmented sentences as a PLAIN STRING
// ARRAY over the joined transcript text. Probing showed the LLM segments text
// well ("It's a popular choice for high performance server side applications...")
// but cuts mid-phrase when asked for index ranges over a fragment array (it
// anchors on fragment boundaries). The LLM edits the text (capitalization,
// punctuation, occasional word merges like "Cockroach DB"→"CockroachDB"), so we
// localize each returned sentence back to the original event timestamps via
// normalized char-substring matching (robust to those edits).
//
// Best-effort: returns [] on any failure (LLM down / misalignment) so the
// caller falls back to parseJson3 — never blocks import.

import { z } from "zod";
import { toJsonSchema } from "@/lib/ai-schemas";
import { recordCost } from "@/lib/cost-tracker";
import { isSpeech } from "@/lib/subtitle-parse";
import type { MaterialSentence } from "@/lib/types";

interface TextEvent {
  i: number; // index into the ORIGINAL events array (for dDurationMs lookup)
  text: string;
  tStartMs: number; // event's absolute start (raw events[i].tStartMs; non-null by construction)
  segs?: { utf8?: string; tOffsetMs?: number }[]; // FILTERED non-empty segs — owner.si indexes THIS array, so segStartMs must read it here, not the raw event's unfiltered segs (whose indices drift when leading empty segs are filtered out).
}

/** Absolute timestamp (ms) of a seg within its event: event.tStartMs + seg.tOffsetMs. */
const segStartMs = (
  ev: { tStartMs?: number; segs?: { tOffsetMs?: number }[] } | undefined,
  segIdx: number
): number | null => {
  if (!ev || ev.tStartMs == null) return null;
  const off = ev.segs?.[segIdx]?.tOffsetMs ?? 0;
  return ev.tStartMs + off;
};

const segmentationSchema = z.object({
  sentences: z.array(z.string()).default([]),
});

const SYSTEM = [
  "You segment an English ASR transcript (no punctuation, one long string) into complete spoken sentences.",
  "Return each sentence as a string in the `sentences` array, in order.",
  "Rules:",
  "- A complete sentence has a finished subject+verb+thought; the sentence must read as a self-contained statement.",
  "- Cut ONLY at true sentence boundaries. NEVER end mid-phrase — e.g. after a preposition (for/of/with), an article (a/the), or an adjective lacking its noun ('for high' is WRONG when 'high performance server side applications' is the noun phrase).",
  "- When unsure whether a boundary is complete, MERGE rather than SPLIT — a slightly long complete sentence is far better than a truncated half-sentence.",
  "- PRESERVE EVERY WORD'S SPELLING EXACTLY as it appears in the transcript, including ASR mis-hears (e.g. keep 'serers', do not 'correct' it to 'servers'). You may only: add initial capitalization, add a trailing period, and merge a proper noun split by whitespace ('Cockroach DB' → 'CockroachDB'). Do NOT fix, reorder, drop, or reword anything. This exact-word preservation is required so each returned sentence can be machine-matched back to its timestamps in the transcript.",
  "- Drop non-speech markers ([Music], (applause)) only when they stand as their own fragment — do not include them inside a sentence.",
  "- Return ONLY the JSON object matching the schema; no markdown, no commentary.",
].join("\n");

const segmentOnce = async (joined: string): Promise<string[]> => {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // qualityModel (pro): probing showed flash ignores the schema under
      // non-strict mode; pro returns well-formed sentence arrays. Segmentation
      // runs once per imported video, so the higher tier is acceptable.
      model: "deepseek-v4-pro",
      system: SYSTEM,
      prompt: `Segment this transcript into complete sentences.\n\nTranscript:\n${joined}`,
      schema: toJsonSchema(segmentationSchema),
      temperature: 0,
      // Long transcripts surface as 200+ sentences; 4096 tokens truncates that
      // mid-JSON and the structured parse yields an empty array, silently
      // bailing the whole segmentation to parseJson3 fragments. 8192 leaves
      // headroom (observed ~4k tokens for 236 sentences).
      maxOutputTokens: 8192,
      disableThinking: true,
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    object?: z.infer<typeof segmentationSchema>;
    error?: string;
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
  };
  if (data.usage && data.model) {
    recordCost({
      model: data.model,
      inputTokens: data.usage.inputTokens ?? 0,
      outputTokens: data.usage.outputTokens ?? 0,
      module: "listening-segment",
    });
  }
  if (data.error || !data.object) return [];
  return data.object.sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

// Char-stream normalization for substring localization: lowercase, drop
// punctuation + spaces. "Cockroach DB" and "CockroachDB" both -> "cockroachdb";
// "Go"/"go" -> "go". Crucially, non-speech markers "[__]", "[Music]" normalize
// to nothing (no alnum), so an LLM that drops them still matches the ASR char
// stream — and because the LLM is told to PRESERVE word spelling exactly (not
// fix ASR mis-hears), a whole-sentence char substring matches verbatim. That
// exact match is the precise localization layer; a first/last-word fallback
// covers the rare sentence where the LLM still merged/split a word.
//
// `owner[k]` = { fi, si } maps normalized char k -> its source textEvent (fi)
// and the seg WITHIN that event (si), so a sentence's start can be timed to the
// SEG level (event.tStartMs + seg.tOffsetMs) — not just the event's first-word
// tStartMs. This matters when the LLM starts a sentence mid-event (e.g. event
// "century it's a popular..." t=5560, LLM sentence "It's a popular..." starts at
// seg "it's" tOffsetMs=520 -> 6080ms, not 5560ms which would drag in "century").
const buildNormalizedStream = (
  textEvents: TextEvent[]
): { stream: string; owner: { fi: number; si: number }[] } => {
  let stream = "";
  const owner: { fi: number; si: number }[] = [];
  for (let fi = 0; fi < textEvents.length; fi++) {
    const segs = textEvents[fi].segs ?? [];
    for (let si = 0; si < segs.length; si++) {
      for (const ch of segs[si].utf8 ?? "") {
        if (/[a-z0-9]/i.test(ch)) {
          stream += ch.toLowerCase();
          owner.push({ fi, si });
        }
      }
    }
  }
  return { stream, owner };
};

/** Segment YouTube json3 events into sentence-bounded MaterialSentences via LLM.
 *  Returns [] on any failure (caller falls back to parseJson3). */
export const segmentSentencesFromJson3 = async (
  events: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[]
): Promise<MaterialSentence[]> => {
  try {
    const textEvents: TextEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev?.tStartMs == null) continue;
      const segs = (ev.segs ?? []).filter((s) => (s.utf8 ?? "").replace(/\n/g, "").trim().length > 0);
      const raw = segs
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!raw) continue;
      textEvents.push({ i, text: raw, segs, tStartMs: ev.tStartMs });
    }
    if (textEvents.length === 0) return [];

    const joined = textEvents.map((t) => t.text).join(" ");
    const sentences = await segmentOnce(joined);
    if (sentences.length === 0) return [];

    const { stream, owner } = buildNormalizedStream(textEvents);

    // Localize each sentence (in order) against the normalized char stream from
    // a running cursor. Cursor advances past each match, so sentences can't
    // re-claim earlier text (LLM preserves word order).
    //
    // Two layers (per-word greedy with a span cap was tried and rejected — it
    // drifts: when a mid-sentence word is absent the next word's "next
    // occurrence" leaps to a later repeat of that word within the cap window,
    // and the cursor runs away, collapsing later sentences):
    //   1. Whole-sentence normalized substring (exact). Works because the LLM is
    //      told to preserve word spelling verbatim (only punctuate/capitalize),
    //      and non-speech markers normalize to nothing — so the LLM sentence and
    //      the ASR char stream agree character-for-character.
    //   2. First/last word fallback. For the rare sentence where the LLM still
    //      merged/split a word (e.g. 'Cockroach DB'→'CockroachDB' shifts the last
    //      word), locate the sentence's first and last normalizable words and
    //      span them. Tolerates a mid-sentence edit as long as the boundary
    //      words survive.
    const result: MaterialSentence[] = [];
    let cursor = 0;
    let failCount = 0;
    for (const sentence of sentences) {
      const norm = sentence
        .split("")
        .filter((c) => /[a-z0-9]/i.test(c))
        .join("")
        .toLowerCase();
      if (norm.length === 0) continue;
      const at = stream.indexOf(norm, cursor);
      if (at === -1) {
        // Whole-sentence match failed — the LLM edited a word. Fall back to
        // FIRST/LAST word localization: find the sentence's first and last
        // normalizable words in the stream from the cursor, and span them.
        const words = sentence
          .split(/\s+/)
          .map((w) => w.split("").filter((c) => /[a-z0-9]/i.test(c)).join("").toLowerCase())
          .filter((w) => w.length > 0);
        if (words.length < 2) {
          failCount++;
          continue;
        }
        const firstWord = words[0];
        const lastWord = words[words.length - 1];
        const fAt = stream.indexOf(firstWord, cursor);
        const lAt = fAt === -1 ? -1 : stream.indexOf(lastWord, fAt + firstWord.length);
        if (fAt === -1 || lAt === -1) {
          failCount++;
          continue;
        }
        const firstOwner = owner[fAt];
        const lastOwner = owner[lAt + lastWord.length - 1];
        const firstTE = textEvents[firstOwner.fi];
        const lastTE = textEvents[lastOwner.fi];
        const lastEv = events[lastTE.i]; // raw event, only for dDurationMs
        if (!lastEv) {
          failCount++;
          continue;
        }
        if (!isSpeech(sentence)) continue;
        const startMs = segStartMs(firstTE, firstOwner.si) ?? firstTE.tStartMs;
        const endMs = lastTE.tStartMs + (lastEv.dDurationMs ?? 0);
        result.push({
          text: sentence,
          audioStartMs: startMs,
          audioEndMs: Number.isFinite(endMs) && endMs > startMs ? endMs : undefined,
        });
        cursor = lAt + lastWord.length;
        continue;
      }
      const end = at + norm.length - 1; // inclusive
      const firstOwner = owner[at];
      const lastOwner = owner[end];
      const firstTE = textEvents[firstOwner.fi];
      const lastTE = textEvents[lastOwner.fi];
      const lastEv = events[lastTE.i]; // raw event, only for dDurationMs (endMs)
      if (!lastEv) {
        failCount++;
        continue;
      }
      // Seg-level start: owner.si indexes firstTE.segs (the FILTERED array on
      // the TextEvent), so segStartMs reads that same array — NOT the raw
      // event's unfiltered segs. Raw indices don't line up with filtered ones
      // when leading empty/whitespace segs were dropped, which silently read
      // the wrong (empty) seg's tOffsetMs==undefined→0 and fell back to event
      // tStartMs — defeating the seg-level fix. endMs stays event-level
      // (clamped to the next sentence's start in playSentence, so a slightly-
      // late end is harmless).
      const startMs = segStartMs(firstTE, firstOwner.si) ?? firstTE.tStartMs;
      const lastStartMs = lastTE.tStartMs;
      if (startMs == null || lastStartMs == null) {
        failCount++;
        continue;
      }
      if (!isSpeech(sentence)) continue;
      const endMs = lastStartMs + (lastEv.dDurationMs ?? 0);
      result.push({
        text: sentence,
        audioStartMs: startMs,
        audioEndMs: Number.isFinite(endMs) && endMs > startMs ? endMs : undefined,
      });
      cursor = end + 1;
    }

    // If too many sentences failed to localize, the LLM likely paraphrased
    // heavily — bail to parseJson3 rather than ship a partial/half-timed set.
    if (result.length === 0 || failCount > sentences.length * 0.3) return [];

    // Adjacent-overlap clamp: ASR event timestamps interleave, so a sentence's
    // endMs (last event start+dur) can land inside the next sentence's startMs.
    // Clamp each endMs down to the next sentence's start (sorted by start first).
    result.sort((a, b) => (a.audioStartMs ?? 0) - (b.audioStartMs ?? 0));
    for (let i = 0; i < result.length - 1; i++) {
      const nextStart = result[i + 1].audioStartMs;
      if (
        result[i].audioEndMs != null &&
        nextStart != null &&
        result[i].audioEndMs! > nextStart
      ) {
        result[i].audioEndMs = Math.max(nextStart, result[i].audioStartMs! + 1);
      }
    }
    return result;
  } catch {
    return [];
  }
};
