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
  "- Cut ONLY at a true sentence boundary: the sentence has a complete subject+verb+object (or equivalent) and the thought is FINISHED. Keep merging until the thought is complete.",
  "- NEVER cut mid-phrase: do not end a sentence after a preposition (\"for\", \"of\", \"with\"), an article (\"a\", \"the\"), an adjective lacking its noun (\"high\" without \"performance\"), or any incomplete clause. If a fragment leaves a phrase open, it MUST merge with the next.",
  "- When unsure whether a boundary is complete, MERGE rather than SPLIT — a slightly long complete sentence is far better than a truncated half-sentence.",
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
  return data.object.sentences;
};

// Sanitize LLM ranges: back-fill a missing startIdx/endIdx from the other
// (single-fragment [s,s]), clamp out-of-bounds to [0, batchLen-1], sort, merge
// overlaps. Clamping (not rejecting) is deliberate: prod probing shows the LLM
// (even pro) routinely returns a slightly-oversized endIdx (e.g. 78 when the
// batch is 71) — clamping that to the last index is safe (sentence end aligns
// to the final event) and far better than rejecting the whole batch, which
// would fall back to ALL parseJson3 fragments. Non-integer/fully-missing
// entries are skipped (don't fail the batch).
const sanitizeRanges = (
  raw: { startIdx?: number; endIdx?: number }[],
  batchLen: number
): { startIdx: number; endIdx: number }[] => {
  if (batchLen === 0) return [];
  const out: { startIdx: number; endIdx: number }[] = [];
  for (const r of raw) {
    const s = r.startIdx;
    const e = r.endIdx;
    if (s == null && e == null) continue; // unusable entry
    let start = (s ?? e) as number;
    let end = (e ?? s) as number;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    // Clamp to valid range (LLM often overshoots endIdx; clamping is safe here).
    start = Math.max(0, Math.min(start, batchLen - 1));
    end = Math.max(0, Math.min(end, batchLen - 1));
    if (start > end) [start, end] = [end, start];
    out.push({ startIdx: start, endIdx: end });
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
    // Single batch (whole transcript at once). Batching cuts sentences at batch
    // edges ("...version 1.0 was" / "released in 2012..." split across batches),
    // which reads as a truncated sentence — the worst outcome for listening. A
    // typical YouTube transcript is fewer than ~400 short fragments (<30KB JSON),
    // well under both model context and the /api/review 100KB body limit. If a
    // pathologically long transcript exceeds the limit, /api/review returns 413,
    // segmentBatch returns [], and the caller falls back to parseJson3 fragments.
    const batch = textEvents;
    const ranges = sanitizeRanges(await segmentBatch(batch), batch.length);

    // Track which positions the LLM covered; uncovered positions (the LLM
    // dropped speech it shouldn't have, or a coverage gap) become their own
    // single-event sentences so NO speech text is silently lost.
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
    // Adjacent-sentence overlap fix: json3 ASR event timestamps naturally
    // overlap/interleave, so a merged sentence's endMs (last event start+dur)
    // often lands inside the NEXT sentence's startMs — seeking to the next
    // sentence mid-overlap feels broken. Clamp each sentence's endMs down to
    // the next sentence's audioStartMs (sorted by start first so "next" is
    // temporal). The final sentence keeps its computed end.
    result.sort((a, b) => (a.audioStartMs ?? 0) - (b.audioStartMs ?? 0));
    for (let i = 0; i < result.length - 1; i++) {
      const nextStart = result[i + 1].audioStartMs;
      if (
        result[i].audioEndMs != null &&
        nextStart != null &&
        result[i].audioEndMs! > nextStart
      ) {
        // Don't shrink below this sentence's own start (keep a non-empty window).
        result[i].audioEndMs = Math.max(nextStart, result[i].audioStartMs! + 1);
      }
    }
    return result;
  } catch {
    return [];
  }
};
