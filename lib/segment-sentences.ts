// LLM sentence segmentation for YouTube json3 auto-captions.
//
// YouTube ASR json3 events are phrase-level chunks (1-5s, no terminal
// punctuation) — one-event-per-sentence (parseJson3) leaves fragments, so the
// listening AB-loop反复 on half-sentences. This module re-groups events into
// complete spoken sentences by asking the LLM for index ranges, then derives
// precise per-sentence timing from the first/last event's tStartMs/dDurationMs
// (no text-matching drift). YouTube json3 path only; manual srt/vtt (already
// sentence-like) and Bilibili are untouched.
//
// Best-effort: returns [] on any failure (LLM down / empty / network) so the
// caller falls back to parseJson3 — never blocks import.

import { z } from "zod";
import { toJsonSchema } from "@/lib/ai-schemas";
import { recordCost } from "@/lib/cost-tracker";
import { isSpeech } from "@/lib/subtitle-parse";
import type { MaterialSentence } from "@/lib/types";

// An event the LLM considers speech, plus its ORIGINAL index (the LLM only sees
// `i` + `text`; timing is re-attached from the original events array by index).
interface TextEvent {
  i: number; // index into the ORIGINAL events array
  text: string;
}

const BATCH_SIZE = 40;

const segmentationSchema = z.object({
  sentences: z
    .array(
      z.object({
        // Inclusive index range into the batch's input TextEvent[] array.
        startIdx: z.number().int(),
        endIdx: z.number().int(),
      })
    )
    .default([]),
});

const SYSTEM = [
  "You segment English ASR caption fragments into complete spoken sentences.",
  "Input: a JSON array of plain strings (caption fragments, in speaking order).",
  "Output: group consecutive fragments into sentences by returning index ranges",
  "[startIdx, endIdx] — ZERO-BASED POSITIONS into the input array (inclusive).",
  "Rules:",
  "- startIdx/endIdx are positions in the input array (0 = first element), NOT any id field — the input has no ids.",
  "- Each sentence must be a grammatically complete thought; merge fragments that belong together.",
  "- Never split inside a fragment.",
  "- Cover EVERY input fragment exactly once (no gaps, no overlaps) — every position must belong to one range, unless it is non-speech.",
  "- Non-speech fragments (e.g. \"[Music]\", \"(applause)\"): you may omit them, but state ranges only over speech positions.",
  "- Prefer fewer, longer sentences over many short ones.",
  "- Each range object MUST contain BOTH startIdx and endIdx (never just one).",
  "- Example: input [\"go a statically typed\",\"compiled language\",\"often described as\",\"C for the 21st century\"] → {\"sentences\":[{\"startIdx\":0,\"endIdx\":3}]} (all four merged into one sentence).",
  "- Return ONLY the JSON object matching the schema; no markdown, no commentary.",
].join("\n");

const segmentBatch = async (
  batch: TextEvent[]
): Promise<{ startIdx: number; endIdx: number }[]> => {
  // Send the LLM a plain array of STRINGS only — no `i` field, so the model
  // cannot anchor on an id and return it instead of a 0-based position. The
  // `i`→original-event mapping is kept client-side in `batch` ( TextEvent ),
  // so batch-local positions translate back to timing via batch[pos].i.
  const userPayload = JSON.stringify(batch.map((t) => t.text));
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `Segment these caption fragments into complete sentences.\n\nInput array (each element is one fragment, 0-indexed):\n${userPayload}`,
      system: SYSTEM,
      schema: toJsonSchema(segmentationSchema),
      // qualityModel (pro), NOT flash: probing prod showed flash ignores the
      // schema under non-strict mode (returns {startIdx} without endIdx, and
      // doesn't merge fragments), while pro returns well-formed ranges. Segmentation
      // runs once per imported video, so the higher tier is acceptable.
      model: "deepseek-v4-pro",
      temperature: 0,
      maxOutputTokens: 2048,
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
  return data.object.sentences;
};

// Sanitize LLM ranges. The 0g router runs WITHOUT structured-outputs enforcement
// (supportsStructuredOutputs is off unless OG_NATIVE_JSON_SCHEMA=1), so the model
// can return malformed objects — e.g. {startIdx:0} missing endIdx, or split a
// pair into two single-field objects. We COPE rather than reject: a missing
// field is back-filled from the other (a single-fragment sentence [s,s]); only
// fully-missing (both undefined) entries are dropped. Out-of-bounds whole-object
// => null (whole-batch bail to parseJson3, since a hallucinated index can't be
// safely salvaged).
const sanitizeRanges = (
  raw: { startIdx?: number; endIdx?: number }[],
  batchLen: number
): { startIdx: number; endIdx: number }[] | null => {
  if (batchLen === 0) return [];
  const out: { startIdx: number; endIdx: number }[] = [];
  for (const r of raw) {
    const s = r.startIdx;
    const e = r.endIdx;
    // Both missing → unusable entry, skip (don't fail the whole batch).
    if (s == null && e == null) continue;
    // Back-fill a missing side from the other (single-fragment sentence).
    const start = s ?? e!;
    const end = e ?? s!;
    // Out-of-bounds / non-integer → can't safely salvage → bail the batch.
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < 0 ||
      start >= batchLen ||
      end >= batchLen
    ) {
      return null;
    }
    let lo = start;
    let hi = end;
    if (lo > hi) [lo, hi] = [hi, lo];
    out.push({ startIdx: lo, endIdx: hi });
  }
  out.sort((a, b) => a.startIdx - b.startIdx);
  // Merge overlaps (keep earlier; extend to the later's end).
  const merged: { startIdx: number; endIdx: number }[] = [];
  for (const r of out) {
    const prev = merged[merged.length - 1];
    if (prev && r.startIdx <= prev.endIdx) {
      prev.endIdx = Math.max(prev.endIdx, r.endIdx);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
};

/** Segment YouTube json3 events into sentence-bounded MaterialSentences via LLM.
 *  Returns [] on any failure (caller falls back to parseJson3). */
export const segmentSentencesFromJson3 = async (
  events: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[]
): Promise<MaterialSentence[]> => {
  try {
    // Keep only text-bearing speech events; remember original index for timing.
    const textEvents: TextEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev?.tStartMs == null) continue;
      const raw = (ev.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!raw) continue; // drop pure-\n / meta events
      textEvents.push({ i, text: raw });
    }
    if (textEvents.length === 0) return [];

    const result: MaterialSentence[] = [];
    for (let start = 0; start < textEvents.length; start += BATCH_SIZE) {
      const batch = textEvents.slice(start, start + BATCH_SIZE);
      const ranges = sanitizeRanges(await segmentBatch(batch), batch.length);
      // A null sanitize = out-of-bounds/hallucinated index → treat as total
      // failure: bail to the parseJson3 fallback rather than emit corrupted
      // sentences. (Partial-batch degradation isn't worth the complexity —
      // parseJson3 fragments for the whole video are still usable.)
      if (ranges === null) return [];

      // Track which batch positions the LLM covered; uncovered positions (the
      // LLM dropped speech it shouldn't have, or a coverage gap) become their
      // own single-event sentences so NO speech text is silently lost.
      const covered = new Array<boolean>(batch.length).fill(false);
      for (const r of ranges) {
        for (let p = r.startIdx; p <= r.endIdx; p++) covered[p] = true;
        const firstEv = events[batch[r.startIdx].i];
        const lastEv = events[batch[r.endIdx].i];
        if (!firstEv || !lastEv) continue;
        const startMs = firstEv.tStartMs;
        const lastStartMs = lastEv.tStartMs;
        if (startMs == null || lastStartMs == null) continue;
        const text = batch
          .slice(r.startIdx, r.endIdx + 1)
          .map((t) => t.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (!isSpeech(text)) continue; // all-non-speech merged range — skip
        const endMs = lastStartMs + (lastEv.dDurationMs ?? 0);
        result.push({
          text,
          audioStartMs: startMs,
          // toSentence's endMs>startMs guard inlined (字幕 parse 约束一致)
          audioEndMs: Number.isFinite(endMs) && endMs > startMs ? endMs : undefined,
        });
      }
      // Uncovered positions: emit each as its own single-fragment sentence so
      // speech is never silently dropped (degrades to parseJson3-like granularity
      // for just those fragments, not the whole video).
      for (let p = 0; p < batch.length; p++) {
        if (covered[p]) continue;
        const ev = events[batch[p].i];
        if (!ev || ev.tStartMs == null) continue;
        const text = batch[p].text;
        if (!isSpeech(text)) continue;
        const startMs = ev.tStartMs;
        const endMs = startMs + (ev.dDurationMs ?? 0);
        result.push({
          text,
          audioStartMs: startMs,
          audioEndMs: Number.isFinite(endMs) && endMs > startMs ? endMs : undefined,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
};
