# IELTS Speaking Part 2 Practice Mode — Design

Date: 2026-07-21
Status: Approved for planning

## Problem & Motivation

The existing real-time conversation mode (`app/conversation/[id]/page.tsx`) has a
user-perceived "transcribing" pause: after the user stops talking, the UI shows
"Transcribing…" while a one-shot Whisper request runs, then the reply is
generated. This breaks the illusion of a live phone-like call.

Root cause (verified): the STT provider (0G router,
`https://router-api.0g.ai/v1/audio/transcriptions`) exposes **only a one-shot
batch Whisper endpoint** — no streaming/realtime STT, no speech-to-speech. Its
documented endpoints are `/chat/completions`, `/images/generations`,
`/audio/transcriptions`. There is therefore no way to eliminate the transcription
latency while staying on 0G.

**Hard constraint (product decision): use only 0G.** No new STT/LLM/TTS vendor.

### The reframe

Instead of fighting the latency, change the interaction model so the latency is
*expected* rather than jarring. IELTS Speaking Part 2 is a **long monologue**:
the test-taker prepares, then speaks continuously for 1–2 minutes, then waits for
feedback. In that model there is no expectation of an instant reply — a
"Transcribing…" step after a 2-minute monologue reads as natural processing time,
exactly like a real examiner not responding the instant you stop.

This mode is **added alongside** the existing conversation mode; the real-time
conversation page is left untouched.

## Goal

Faithfully recreate the **real IELTS Speaking Part 2 experience**, end to end,
using only 0G, and maximally reusing existing app infrastructure.

## Verified IELTS Part 2 Format (recreated exactly)

- **Cue card**: one topic line + exactly **4** bullet points ("You should say:").
- **Preparation**: exactly **60 seconds**; the test-taker may take notes.
- **Long turn**: speak **1–2 minutes** (target ~1:45); examiner stops you at 2:00.
- **Follow-up**: examiner asks **1–2 short follow-up questions** on the topic.

This design reproduces all four beats.

## A Complete Practice Round

1. **Cue card presented** — a random cue card from the static bank is shown
   (topic + 4 bullets). Optional TTS reads it aloud (reuses `lib/tts.ts`).
2. **60s preparation** — a countdown timer runs. A notes textarea is available
   (notes are local-only, not scored, not sent to the LLM). The user may tap
   "I'm ready" to skip the remaining prep and start early.
3. **Long turn (monologue)** — recording starts (reuses
   `startRecording()` from `lib/speech.ts`). A count-**up** timer shows elapsed
   time with a 2:00 visual ceiling; at 2:00 recording auto-stops (examiner
   behavior). The user may also tap "Stop" any time after a minimum (~30s).
4. **Transcription** — the recorded monologue is transcribed once via the
   existing Whisper path. A "Transcribing…" state here is acceptable and
   expected (the whole premise of this mode).
5. **IELTS scoring & correction** — the transcript is sent to `/api/review`
   (generic `generateObject`) with a Part-2-specific prompt + schema. Scores use
   the **four official IELTS band descriptors**: Fluency & Coherence, Lexical
   Resource, Grammatical Range & Accuracy, Pronunciation. Plus error/improvement
   corrections (faithful to the app's error-correction core value).
6. **Follow-up (1–2 questions)** — after the monologue is scored, 1–2 follow-up
   questions are generated via `/api/review` (generateObject, returning
   `{ questions: string[] }`) on the same
   topic. The user answers each **by voice** (reuses `startRecording()` +
   Whisper). Follow-up answers are transcribed and included in a lighter,
   combined feedback note (not re-scored on the full 4-band rubric — kept short
   to control cost and complexity).

## Architecture: Reuse Map

| Concern | Reuse / New | Detail |
|---|---|---|
| Recording + STT | **Reuse** `lib/speech.ts` `startRecording()` | One-shot Whisper — fits monologue perfectly. No barge-in needed here. |
| Read cue card aloud | **Reuse** `lib/tts.ts` `speakStream()` | Optional; user can toggle. |
| Scoring / correction | **Reuse** `/api/review` (generic generateObject) + `toJsonSchema()` | New Part-2 schema in `lib/ai-schemas.ts`. |
| Follow-up generation | **Reuse** `/api/review` (generateObject) | One short structured LLM call returning `{ questions: string[] }`. |
| Persistence | **Reuse** IndexedDB `db` (Dexie) | New `part2Sessions` table (schema v7). |
| Cost tracking | **Reuse** `recordCost()` (`lib/cost-tracker.ts`) | module: `"ielts-part2"`. |
| Daily stats / streak | **Reuse** `dbHelpers` | Increment a Part 2 counter (see Open Decisions). |
| SRS "add to vocab" | **Reuse** existing review-page pattern | New vocab surfaced from the monologue. |
| Cue card bank | **New** static data file | Pulled from public IELTS Liz topic bank; see below. |
| Part 2 pages/timers | **New** route `app/ielts/part2/...` | See Routing. |
| Nav entry | **New** item in `components/sidebar-nav.tsx` | "IELTS Part 2". |

## Cue Card Bank (static, offline, zero runtime cost)

- Source: publicly available IELTS Speaking Part 2 topic list (IELTS Liz),
  a widely-published teaching resource. Cards are normalized into standard cue
  card shape (one topic line + exactly 4 "You should say" bullets). Cards from
  the source that don't have exactly 4 bullets are either normalized to 4 or
  dropped.
- Stored in `lib/ielts-part2-cards.ts` as a typed array:
  ```ts
  export interface Part2Card {
    id: string;          // stable slug, e.g. "describe-a-book"
    topic: string;       // "Describe a book you enjoyed reading"
    bullets: [string, string, string, string];  // exactly 4
    category: "person" | "place" | "object" | "event" | "activity";
  }
  ```
- Selection: random pick, avoiding immediate repeats (track last-seen id in
  memory / localStorage).
- Runtime: **zero** network calls, **zero** LLM cost to obtain a card.

## Data Model (Dexie v7)

New table `part2Sessions`:

```ts
export interface Part2Session {
  id: string;                 // uuid
  cardId: string;
  topic: string;
  transcript: string;         // the monologue transcript
  durationSec: number;        // actual speaking time
  review: Part2Review | null; // null until scored
  followUps: Array<{ question: string; answer: string }>;
  createdAt: Date;
}

export interface Part2Review {
  scores: {
    fluencyCoherence: number;      // 0-100 (normalized from band, see below)
    lexicalResource: number;
    grammaticalRange: number;
    pronunciation: number;         // caveat below
  };
  bandEstimate: number;            // 0-9 overall IELTS band, 0.5 steps
  errors: Array<{ original: string; corrected: string; explanation: string }>;
  improvements: Array<{ original: string; improved: string; context: string }>;
  highlights: Array<{ text: string; reason: string }>;
  newVocabulary: Array<{ word: string; lemma: string; definition: string; example: string }>;
  followUpFeedback: string;        // short combined note on follow-up answers
}
```

Migration: `db.version(7).stores({ ...v6, part2Sessions: "id, cardId, createdAt" })`.
No data backfill needed (new table only).

### Scoring scale note

The existing app stores subjective scores as 0–100 (see db v5 migration).
For consistency, Part 2 sub-scores are stored 0–100. The LLM is prompted on the
**IELTS 0–9 band** rubric (its natural scale) and also returns an overall
`bandEstimate` (0–9). The client normalizes the four sub-bands to 0–100 for
storage/display consistency, and shows the 0–9 `bandEstimate` prominently as the
headline (that's what IELTS learners care about).

### Pronunciation caveat (must be surfaced in UI)

Whisper transcribes text; it does **not** give reliable pronunciation
assessment. A "Pronunciation" band derived by an LLM from a transcript is a
**weak proxy** (it can only infer from spelling/phonetic hints in the
transcript, not actual audio). The UI must label this sub-score as an
**estimate / experimental** and not overstate it. (Real pronunciation scoring
would need a phoneme-level audio model — out of scope, and not available on 0G.)

## Faithful-transcription requirement (unchanged core value)

This app's error-correction loop depends on Whisper faithfully transcribing the
learner's actual mistakes (see `2026-07-20-voice-whisper-design.md`). Part 2
reuses the same Whisper path with the same faithful-transcription prompt
(`app/api/stt/route.ts`), so this property is preserved. The Part 2 scoring
prompt explicitly scores the transcript **as spoken**, without silently
correcting it.

## Routing

- `app/ielts/part2/page.tsx` — entry/landing: "Start a Part 2", shows a fresh
  random cue card and a "Start" button; also links to history.
- `app/ielts/part2/[id]/page.tsx` — the live session (prep → speak → transcribe
  → score → follow-up), driven by a small explicit state machine (see below).
- Reuse pattern from conversation review inline (no separate review route
  needed — Part 2 shows results on the same session page after scoring, since
  there's a single monologue rather than a long chat to re-render).

### Session state machine (explicit enum — avoids the conversation page's

implicit multi-flag tangle):

```
type Part2Phase =
  | "prep"          // 60s countdown, notes allowed
  | "speaking"      // recording, count-up to 2:00
  | "transcribing"  // one-shot whisper
  | "scoring"       // /api/review
  | "followup"      // answer 1-2 follow-up questions by voice
  | "done";         // show full results
```

A single `phase` state variable drives the UI, rather than the conversation
page's `micStatus × isSpeaking × isStreaming × voiceMode` combination. This is a
deliberate improvement for a page we're writing fresh.

## Error Handling

- **Mic/permission denied**: same messaging as existing voice mode; block start,
  show actionable error.
- **Transcription failure**: reuse the existing Whisper→SpeechRecognition
  fallback in `lib/speech.ts`. If both fail after the existing retry budget,
  show "Couldn't transcribe your answer — you can re-record" and let the user
  re-record the monologue (the audio is gone, so re-record is the only option,
  consistent with `lib/speech.ts` notes). The 60s prep is NOT repeated on a
  re-record (the user already prepared).
- **Scoring failure** (`/api/review` error): keep the transcript, show it, and
  offer a "Retry scoring" button — never lose the user's monologue.
- **Empty/too-short monologue** (e.g. <10 words): warn and offer re-record
  rather than sending a near-empty transcript to scoring.
- **Navigation away mid-session**: `beforeunload` warning (reuse pattern) while
  a session is in progress and unscored.

## Testing

Per project convention, tests are not written unless requested. Verification
will be type-check (`npx tsc --noEmit`) + lint (`npx eslint . --quiet`) and a
manual run-through of one full round. (Confirm whether the user wants automated
tests — default: no.)

## Open Decisions (resolved by author, flagged for acceptance)

1. **Follow-up depth**: 1–2 questions, answered by voice, given a *short combined*
   feedback note (not a second full 4-band scoring). Rationale: keeps cost and
   round length reasonable while still practicing spontaneous speech.
2. **Daily stats**: Part 2 completions do **not** touch the `dailyStats` schema
   (no new column, and reusing `conversationCount` would be misleading). The
   Part 2 history/count is derived from the `part2Sessions` table directly. This
   keeps the migration to a single new table.
3. **Notes during prep**: local-only scratch, never sent to LLM or scored.
4. **Cue card TTS**: optional, off by default (reading the card is more
   test-realistic; some users prefer it read aloud).

## Out of Scope

- Streaming STT / real-time transcription (0G can't; explicitly rejected).
- Speech-to-speech / voice-native models (0G can't).
- True phoneme-level pronunciation scoring (needs an audio model 0G lacks).
- IELTS Part 1 and Part 3 (this is Part 2 only; Part 3 hinted via follow-ups).
- Modifying the existing real-time conversation mode.
```
