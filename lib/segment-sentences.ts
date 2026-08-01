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
  i: number; // index into the ORIGINAL events array (for timing)
  text: string;
}

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
  "- You may lightly clean each sentence: fix initial capitalization and add a trailing period, and merge split proper nouns (e.g. 'Cockroach DB' → 'CockroachDB'). Do NOT paraphrase or reorder words.",
  "- Drop non-speech fragments ([Music], (applause)) — don't include them in any sentence.",
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
      maxOutputTokens: 4096,
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

// Normalize for substring localization: lowercase, drop punctuation + spaces.
// "Cockroach DB" and "CockroachDB" both -> "cockroachdb"; "Go"/"go" -> "go".
// Returns the normalized string; `owner[i]` = index into textEvents of the
// source fragment that contributed normalized char i.
const buildNormalizedStream = (
  textEvents: TextEvent[]
): { stream: string; owner: number[] } => {
  let stream = "";
  const owner: number[] = [];
  for (let fi = 0; fi < textEvents.length; fi++) {
    const raw = textEvents[fi].text;
    for (const ch of raw) {
      if (/[a-z0-9]/i.test(ch)) {
        stream += ch.toLowerCase();
        owner.push(fi);
      }
    }
    // Joining space between fragments is dropped (not alnum) — fragments'
    // word boundaries disappear in the normalized stream, which is exactly
    // what lets an LLM-merged "CockroachDB" match "cockroach"+"db".
  }
  return { stream, owner };
};

/** Segment YouTube json3 events into sentence-bounded MaterialSentences via LLM.
 *  Returns [] on any failure (caller falls back to parseJson3). */
export const segmentSentencesFromJson3 = async (
  events: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[]
): Promise<MaterialSentence[]> => {
  try {
    const textEvents: TextEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev?.tStartMs == null) continue;
      const raw = (ev.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!raw) continue;
      textEvents.push({ i, text: raw });
    }
    if (textEvents.length === 0) return [];

    const joined = textEvents.map((t) => t.text).join(" ");
    const sentences = await segmentOnce(joined);
    if (sentences.length === 0) return [];

    const { stream, owner } = buildNormalizedStream(textEvents);

    // Localize each sentence (in order) as a normalized substring from a
    // running cursor. Cursor advances past each match, so sentences can't
    // re-claim earlier text (LLM preserves word order).
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
        // The LLM edited beyond punctuation/merges (e.g. "go a" → "Go is"
        // — fixing ASR grammar), so the whole-sentence normalized substring
        // doesn't match. Fall back to FIRST/LAST word localization: find the
        // sentence's first and last normalizable words in the stream from the
        // cursor, and span [firstWordFrag, lastWordFrag]. This tolerates mid-
        // sentence rewrites as long as the boundary words survive.
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
        const firstFragIdx = owner[fAt];
        const lastFragIdx = owner[lAt + lastWord.length - 1];
        const firstEv = events[textEvents[firstFragIdx].i];
        const lastEv = events[textEvents[lastFragIdx].i];
        if (!firstEv || !lastEv || firstEv.tStartMs == null || lastEv.tStartMs == null) {
          failCount++;
          continue;
        }
        if (!isSpeech(sentence)) continue;
        const startMs = firstEv.tStartMs;
        const endMs = lastEv.tStartMs + (lastEv.dDurationMs ?? 0);
        result.push({
          text: sentence,
          audioStartMs: startMs,
          audioEndMs: Number.isFinite(endMs) && endMs > startMs ? endMs : undefined,
        });
        cursor = lAt + lastWord.length;
        continue;
      }
      const end = at + norm.length - 1; // inclusive
      const firstFragIdx = owner[at];
      const lastFragIdx = owner[end];
      const firstEv = events[textEvents[firstFragIdx].i];
      const lastEv = events[textEvents[lastFragIdx].i];
      if (!firstEv || !lastEv) {
        failCount++;
        continue;
      }
      const startMs = firstEv.tStartMs;
      const lastStartMs = lastEv.tStartMs;
      if (startMs == null || lastStartMs == null) {
        failCount++;
        continue;
      }
      // Use the LLM-cleaned sentence text (capitalized/punctuated) for display.
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
