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
  "You segment an English ASR transcript into complete spoken sentences.",
  "Return each sentence as a string in the `sentences` array, in order.",
  "The transcript is given ONE ASR FRAGMENT PER LINE. Each line break marks a speech pause the ASR detected — most lines are a phrase or short interjection. In dense dialogue, a line break is usually a turn change or sentence boundary.",
  "Rules:",
  "- A complete sentence has a finished subject+verb+thought; the sentence must read as a self-contained statement.",
  "- PREFER to cut at LINE BREAKS: the ASR already paused there, so a sentence boundary there is likely correct. Only MERGE across a line break when the next line clearly continues THIS sentence (object/dependent clause of the same thought) — e.g. 'I am' / 'the one who knocks' merges; 'I just want to go home' / 'me too' does NOT (the latter is a separate utterance).",
  "- Never merge many short interjections/replies ('okay' / 'yeah' / 'me too' / 'no') into one sentence — each is its own sentence. A rapid back-and-forth of one-word replies ends each as its own short sentence.",
  "- Cut ONLY at true sentence boundaries. NEVER end mid-phrase — e.g. after a preposition (for/of/with), an article (a/the), or an adjective lacking its noun ('for high' is WRONG when 'high performance server side applications' is the noun phrase).",
  "- PRESERVE EVERY WORD'S SPELLING EXACTLY as it appears in the transcript, including ASR mis-hears (e.g. keep 'serers', do not 'correct' it to 'servers'). You may only: add initial capitalization, add a trailing period, and merge a proper noun split by whitespace ('Cockroach DB' → 'CockroachDB'). Do NOT fix, reorder, drop, or reword anything. This exact-word preservation is required so each returned sentence can be machine-matched back to its timestamps in the transcript. Whitespace between words inside a sentence is a single space.",
  "- Drop non-speech markers ([Music], (applause)) only when they stand as their own line — do not include them inside a sentence.",
  "- Return ONLY the JSON object matching the schema; no markdown, no commentary.",
].join("\n");

const segmentOnce = async (lines: string[]): Promise<string[]> => {
  // Feed the LLM ONE ASR FRAGMENT PER LINE (not a joined flat string). ASR
  // fragment boundaries are speech pauses — in dense dialogue they're mostly
  // turn/sentence changes. Giving the LLM that boundary signal lets it cut at
  // real pauses instead of over-merging rapid back-and-forth replies into one
  // huge sentence (the symptom on O1gFxMoBAVw: a dozen replies became one line
  // because a flat string hid every pause). The line breaks are SIGNAL ONLY:
  // localization matches against a normalized char stream that drops them.
  const transcript = lines.join("\n");
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // qualityModel (pro): probing showed flash ignores the schema under
      // non-strict mode; pro returns well-formed sentence arrays. Segmentation
      // runs once per imported video, so the higher tier is acceptable.
      model: "deepseek-v4-pro",
      system: SYSTEM,
      prompt: `Segment this transcript into complete sentences. Each line below is one ASR fragment (a detected pause). Prefer cutting at line breaks; only merge lines that clearly continue the same sentence.\n\nTranscript:\n${transcript}`,
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

// Split textEvents into overlapping chunks for LLM segmentation. A single
// whole-transcript call degrades on long material: the LLM over-merges (a few
// huge sentences under the "merge rather than split" rule) and risks
// maxOutputTokens truncation. Chunking keeps each LLM call on a short, clean
// span where it segments well.
//
// Cuts fall on EVENT boundaries (never mid-event), so each chunk is a clean
// run of events. Chunks OVERLAP by ~overlapChars so the LLM has cross-boundary
// context to finish/continue sentences straddling a cut — without overlap, a
// sentence spanning a cut would be severed into two fragments. The overlap
// re-emits some sentences twice; those duplicates are removed at localization
// (see the dup-skip below), not here.
//
// char offsets are over the joined `t.text + " "` form so maxChars/overlap map
// to real transcript length, not event count (events vary 1-5s of speech).
const splitTextEvents = (
  textEvents: TextEvent[],
  maxChars = 3000,
  overlapChars = 600
): TextEvent[][] => {
  if (textEvents.length === 0) return [];
  if (textEvents.length === 1) return [textEvents];
  const chunks: TextEvent[][] = [];
  // offsets[k] = char offset of textEvents[k] in the joined stream; offsets[n]=total.
  const offsets: number[] = [0];
  let total = 0;
  for (const t of textEvents) {
    total += t.text.length + 1; // +1 for the joining space
    offsets.push(total);
  }
  const fullLen = total;
  let evStart = 0;
  // Guard against a pathological loop: ensure evStart strictly advances each
  // iteration so a tiny transcript can't spin. Overlap should never push the
  // next start behind the current, but clamp defensively.
  while (evStart < textEvents.length) {
    const charStart = offsets[evStart];
    const charEnd = Math.min(charStart + maxChars, fullLen);
    // Last event whose content ends at/before charEnd (inclusive).
    let evEnd = textEvents.length - 1;
    for (let k = evStart; k < textEvents.length; k++) {
      if (offsets[k + 1] > charEnd) { evEnd = k; break; }
    }
    chunks.push(textEvents.slice(evStart, evEnd + 1));
    if (evEnd >= textEvents.length - 1) break; // reached the end
    // Next chunk starts ~overlapChars before this chunk's end, snapped to an
    // event boundary. Find the first event whose offset is >= (charEnd - overlap).
    const targetCharStart = Math.max(charEnd - overlapChars, 0);
    let evNextStart = evEnd;
    for (let k = evEnd; k >= 0; k--) {
      if (offsets[k] >= targetCharStart) evNextStart = k;
      else break;
    }
    if (evNextStart <= evStart) evNextStart = evStart + 1; // force progress
    evStart = evNextStart;
  }
  return chunks;
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

    // Chunked segmentation for long transcripts: a single whole-transcript call
    // over-merges / truncates on long material (root-caused on a 13K-char
    // montage). Split into overlapping event-boundary chunks, segment each, and
    // concatenate — overlap duplicates are removed at localization below.
    const chunks = splitTextEvents(textEvents);
    const sentences: string[] = [];
    for (const chunk of chunks) {
      sentences.push(...(await segmentOnce(chunk.map((t) => t.text))));
    }
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
        // Dup-skip (chunked segmentation): overlapping chunks re-emit the
        // overlap region's sentences. Such a sentence's text already exists in
        // the stream BEFORE the cursor (a prior chunk localized it and advanced
        // the cursor past it). Detect: the whole-sentence text is found
        // somewhere before the cursor. Skip it — it's already in `result` —
        // WITHOUT counting a failure (a real paraphrase failure doesn't match
        // anywhere, so this check won't swallow those).
        const anywhere = stream.indexOf(norm);
        if (anywhere !== -1 && anywhere < cursor) continue;
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
