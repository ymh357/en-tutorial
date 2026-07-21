# IELTS Speaking Part 2 Practice Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone IELTS Speaking Part 2 practice mode (cue card → 60s prep → timed monologue → transcription → IELTS 4-band scoring + corrections → 1–2 voice follow-ups), reusing existing recording/STT/review/persistence infrastructure, on 0G only.

**Architecture:** New route tree `app/ielts/part2/`, driven by a single explicit `phase` state machine. Reuses `lib/speech.ts` (recording+Whisper), `/api/review` (generateObject) for scoring and follow-up generation, `lib/tts.ts` (optional cue-card read-aloud), and Dexie for persistence (new `part2Sessions` table, schema v7). No backend endpoint changes. Cue cards are a static, offline bank.

**Tech Stack:** Next.js (repo's fork — read `node_modules/next/dist/docs/` before writing routing/data code), React client components, Dexie (IndexedDB), zod v4 (`z.toJSONSchema`), AI SDK `generateObject` via existing `/api/review`.

## Global Constraints

- **Only 0G** as AI vendor. No new STT/LLM/TTS provider. (Verified: 0G has only one-shot Whisper, no streaming/realtime/S2S.)
- **Faithful transcription preserved**: reuse the existing Whisper path + faithful-transcription prompt (`app/api/stt/route.ts`). Scoring prompt scores the transcript *as spoken*, never silently corrects.
- **Do not modify** the existing real-time conversation mode (`app/conversation/**`).
- **Tests**: NOT written unless the user asks (project convention). Each task ends with `npx tsc --noEmit` + `npx eslint . --quiet` + a stated manual verification point instead of automated tests.
- **Scores stored 0–100** (app convention); LLM prompted on IELTS 0–9 band, client normalizes sub-bands to 0–100; overall `bandEstimate` kept 0–9 for the headline.
- **Pronunciation sub-score** must be labeled experimental/estimate in the UI (Whisper gives text, not audio — it's a weak proxy).
- **Git**: commit steps are included but the human runs/approves them (do not auto-commit without confirmation).
- **Read `node_modules/next/dist/docs/`** for any Next.js API before using it — this is a forked Next with breaking changes.

---

### Task 1: Cue card bank (static data)

**Files:**
- Create: `lib/ielts-part2-cards.ts`

**Interfaces:**
- Produces:
  - `interface Part2Card { id: string; topic: string; bullets: [string, string, string, string]; category: "person" | "place" | "object" | "event" | "activity"; }`
  - `export const PART2_CARDS: Part2Card[]`
  - `export const pickRandomCard: (excludeId?: string) => Part2Card`

- [ ] **Step 1: Create the card bank file**

Create `lib/ielts-part2-cards.ts` with the type and a curated set of real IELTS Part 2 cue cards (normalized from the public IELTS Liz topic bank to standard shape: one topic line + exactly 4 "You should say" bullets). Include at least 20 cards spanning all five categories.

```ts
// Real IELTS Speaking Part 2 cue cards, normalized to the standard shape
// (one topic line + exactly four "You should say" bullets). Sourced from the
// publicly published IELTS Liz Part 2 topic bank and reworded into standard
// cue-card phrasing. Static + offline: no network or LLM call to obtain a card.

export interface Part2Card {
  id: string;
  topic: string;
  bullets: [string, string, string, string];
  category: "person" | "place" | "object" | "event" | "activity";
}

export const PART2_CARDS: Part2Card[] = [
  {
    id: "describe-a-book",
    topic: "Describe a book you enjoyed reading",
    bullets: [
      "what kind of book it is",
      "what it is about",
      "what sort of people would enjoy it",
      "and explain why you liked it",
    ],
    category: "object",
  },
  {
    id: "describe-a-person-who-influenced-you",
    topic: "Describe a person who has influenced you",
    bullets: [
      "who this person is",
      "how you know this person",
      "what this person is like",
      "and explain why they have influenced you",
    ],
    category: "person",
  },
  {
    id: "describe-a-journey",
    topic: "Describe a journey that did not go as planned",
    bullets: [
      "where you were going",
      "how you were travelling",
      "what went wrong",
      "and explain what you would do differently",
    ],
    category: "event",
  },
  {
    id: "describe-a-peaceful-place",
    topic: "Describe a peaceful place you like to go to",
    bullets: [
      "where it is",
      "when you first went there",
      "what you do there",
      "and explain why you find it peaceful",
    ],
    category: "place",
  },
  {
    id: "describe-a-hobby",
    topic: "Describe a hobby you enjoy",
    bullets: [
      "what it is",
      "how you got started with it",
      "how often you do it",
      "and explain why you find it interesting",
    ],
    category: "activity",
  },
  {
    id: "describe-a-gift",
    topic: "Describe a gift you gave someone",
    bullets: [
      "who you gave it to",
      "what the gift was",
      "what occasion it was for",
      "and explain why you chose that gift",
    ],
    category: "object",
  },
  {
    id: "describe-a-piece-of-music",
    topic: "Describe a song or piece of music you like",
    bullets: [
      "what kind of song it is",
      "what the song is about",
      "when you first heard it",
      "and explain why you like it",
    ],
    category: "object",
  },
  {
    id: "describe-a-kind-person",
    topic: "Describe a person you know who is kind",
    bullets: [
      "who this person is",
      "how you know this person",
      "what kind things they do",
      "and explain why you think they are kind",
    ],
    category: "person",
  },
  {
    id: "describe-a-favourite-shop",
    topic: "Describe your favourite shop",
    bullets: [
      "where it is",
      "how often you go there",
      "what it sells",
      "and explain why you think it is a good shop",
    ],
    category: "place",
  },
  {
    id: "describe-a-piece-of-good-news",
    topic: "Describe a piece of good news you received",
    bullets: [
      "what the news was",
      "how you received the news",
      "who gave it to you",
      "and explain why it was good news",
    ],
    category: "event",
  },
  {
    id: "describe-an-exercise",
    topic: "Describe a type of exercise you think is good",
    bullets: [
      "what it is",
      "how it is done",
      "when you first tried it",
      "and explain why you think it is a good exercise",
    ],
    category: "activity",
  },
  {
    id: "describe-a-photograph",
    topic: "Describe a photograph you like",
    bullets: [
      "what can be seen in the photo",
      "when it was taken",
      "who took it",
      "and explain why you like it",
    ],
    category: "object",
  },
  {
    id: "describe-a-family-member",
    topic: "Describe a member of your family you get on well with",
    bullets: [
      "who it is",
      "what that person is like",
      "what you do together",
      "and explain why you get on so well",
    ],
    category: "person",
  },
  {
    id: "describe-a-place-near-water",
    topic: "Describe a place near water you like to visit",
    bullets: [
      "where it is",
      "how you get there",
      "what you do there",
      "and explain why you like it",
    ],
    category: "place",
  },
  {
    id: "describe-an-embarrassing-moment",
    topic: "Describe an embarrassing thing that happened to you",
    bullets: [
      "when it was",
      "who you were with",
      "what happened",
      "and explain how you coped afterwards",
    ],
    category: "event",
  },
  {
    id: "describe-a-language",
    topic: "Describe a language you would like to learn",
    bullets: [
      "what it is",
      "how you would learn it",
      "what might be difficult about it",
      "and explain why you want to learn that language",
    ],
    category: "object",
  },
  {
    id: "describe-a-sport",
    topic: "Describe a sport you would like to learn",
    bullets: [
      "what it is",
      "what equipment is needed for it",
      "how you would learn it",
      "and explain why you would like to learn it",
    ],
    category: "activity",
  },
  {
    id: "describe-a-person-you-respect",
    topic: "Describe a person you respect",
    bullets: [
      "who the person is",
      "how you know about this person",
      "what this person does",
      "and explain why you respect this person",
    ],
    category: "person",
  },
  {
    id: "describe-a-way-to-relax",
    topic: "Describe something you do to relax",
    bullets: [
      "what it is",
      "where you do it",
      "when you first did it",
      "and explain why you find it relaxing",
    ],
    category: "activity",
  },
  {
    id: "describe-an-interesting-place",
    topic: "Describe an interesting place you have visited",
    bullets: [
      "where you went",
      "who you went with",
      "how you got there",
      "and explain why you enjoyed it",
    ],
    category: "place",
  },
];

// Random pick that avoids immediately repeating the previous card. Callers pass
// the last-seen id; if excluding it would empty the pool (bank of 1), the guard
// is ignored. Uses Math.random — fine for shuffle, not security-sensitive.
export const pickRandomCard = (excludeId?: string): Part2Card => {
  const pool =
    excludeId && PART2_CARDS.length > 1
      ? PART2_CARDS.filter((c) => c.id !== excludeId)
      : PART2_CARDS;
  return pool[Math.floor(Math.random() * pool.length)];
};
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/ielts-part2-cards.ts --quiet`
Expected: no errors. Every `bullets` array is a 4-tuple matching the type.

- [ ] **Step 3: Manual verification point**

In a scratch node/ts-node or a temporary console log, confirm `pickRandomCard()` returns a card and `pickRandomCard(card.id)` never returns the same id (when bank > 1). Remove any scratch log.

- [ ] **Step 4: Commit** (human runs/approves)

```bash
git add lib/ielts-part2-cards.ts
git commit -m "feat(ielts): add static Part 2 cue card bank"
```

---

### Task 2: Types + scoring schemas

**Files:**
- Modify: `lib/types.ts` (append Part 2 types)
- Modify: `lib/ai-schemas.ts` (append Part 2 zod schemas)

**Interfaces:**
- Consumes: `Part2Card` (Task 1); existing `toJsonSchema` in `lib/ai-schemas.ts`.
- Produces:
  - `lib/types.ts`: `Part2Review`, `Part2Session` (shapes below).
  - `lib/ai-schemas.ts`: `part2ReviewSchema`, `part2FollowUpSchema`, `part2FollowUpFeedbackSchema`.

- [ ] **Step 1: Add types to `lib/types.ts`**

Append:

```ts
export interface Part2Review {
  scores: {
    fluencyCoherence: number;   // 0-100 (normalized from 0-9 band)
    lexicalResource: number;    // 0-100
    grammaticalRange: number;   // 0-100
    pronunciation: number;      // 0-100 — experimental proxy (see design)
  };
  bandEstimate: number;         // 0-9 overall IELTS band (0.5 steps)
  errors: Array<{ original: string; corrected: string; explanation: string }>;
  improvements: Array<{ original: string; improved: string; context: string }>;
  highlights: Array<{ text: string; reason: string }>;
  newVocabulary: Array<{
    word: string;
    lemma: string;
    definition: string;
    example: string;
  }>;
  followUpFeedback: string;
}

export interface Part2Session {
  id: string;
  cardId: string;
  topic: string;
  transcript: string;
  durationSec: number;
  review: Part2Review | null;
  followUps: Array<{ question: string; answer: string }>;
  createdAt: Date;
}
```

- [ ] **Step 2: Add zod schemas to `lib/ai-schemas.ts`**

Follow the existing `conversationReviewSchema` style (bands on 0–9 as the LLM's natural scale; client normalizes later):

```ts
export const part2ReviewSchema = z.object({
  scores: z.object({
    fluencyCoherence: z.number().min(0).max(9),
    lexicalResource: z.number().min(0).max(9),
    grammaticalRange: z.number().min(0).max(9),
    pronunciation: z.number().min(0).max(9),
  }),
  bandEstimate: z.number().min(0).max(9),
  errors: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      explanation: z.string(),
    })
  ),
  improvements: z.array(
    z.object({
      original: z.string(),
      improved: z.string(),
      context: z.string(),
    })
  ),
  highlights: z.array(
    z.object({ text: z.string(), reason: z.string() })
  ),
  newVocabulary: z.array(
    z.object({
      word: z.string(),
      lemma: z.string(),
      definition: z.string(),
      example: z.string(),
    })
  ),
});

export const part2FollowUpSchema = z.object({
  questions: z.array(z.string()).min(1).max(2),
});

export const part2FollowUpFeedbackSchema = z.object({
  feedback: z.string(),
});
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/types.ts lib/ai-schemas.ts --quiet`
Expected: no errors.

- [ ] **Step 4: Commit** (human runs/approves)

```bash
git add lib/types.ts lib/ai-schemas.ts
git commit -m "feat(ielts): add Part 2 session types and scoring schemas"
```

---

### Task 3: Dexie schema v7 (`part2Sessions` table)

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Consumes: `Part2Session` (Task 2).
- Produces: `db.part2Sessions` typed `EntityTable<Part2Session, "id">`.

- [ ] **Step 1: Import the type and add table typing**

In `lib/db.ts`, add `Part2Session` to the type import block and to the intersection type:

```ts
import type {
  // ...existing imports...
  Part2Session,
} from "./types";
```

```ts
const db = new Dexie("EnTutorDB") as Dexie & {
  // ...existing tables...
  part2Sessions: EntityTable<Part2Session, "id">;
};
```

- [ ] **Step 2: Add version 7 store (new table only, no data migration)**

Append after the `db.version(6)...` block:

```ts
db.version(7).stores({
  // identical to v6, plus the new part2Sessions table.
  cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
  conversations: "id, scenarioType, createdAt",
  readingSessions: "id, source, createdAt",
  writingSessions: "id, taskType, createdAt",
  learningProfile: "id",
  dailyStats: "id",
  listeningExercises: "id, mode, createdAt",
  translationExercises: "id, mode, createdAt",
  poolTasks: "id, type, assignedDate, completed, createdAt",
  assessments: "id, date",
  part2Sessions: "id, cardId, createdAt",
});
```

(No `.upgrade()` needed — adding a table requires no data backfill.)

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/db.ts --quiet`
Expected: no errors.

- [ ] **Step 4: Manual verification point**

Load the app in the browser; open DevTools → Application → IndexedDB → EnTutorDB and confirm an `part2Sessions` object store now exists and the DB version is 7. Confirm existing data (cards, conversations) is intact.

- [ ] **Step 5: Commit** (human runs/approves)

```bash
git add lib/db.ts
git commit -m "feat(ielts): add part2Sessions table (Dexie v7)"
```

---

### Task 4: Scoring/follow-up helper module

**Files:**
- Create: `lib/ielts-part2-review.ts`

**Interfaces:**
- Consumes: `part2ReviewSchema`, `part2FollowUpSchema`, `part2FollowUpFeedbackSchema`, `toJsonSchema` (Task 2); `Part2Review` (Task 2); `recordCost` (`lib/cost-tracker.ts`).
- Produces:
  - `scorePart2Monologue(topic: string, bullets: string[], transcript: string): Promise<Part2Review>` — returns a review with sub-scores already normalized to 0–100 and `followUpFeedback` left as `""` (filled by Task's follow-up step later).
  - `generateFollowUps(topic: string, transcript: string): Promise<string[]>`
  - `reviewFollowUpAnswers(topic: string, qa: Array<{ question: string; answer: string }>): Promise<string>`

This module isolates all `/api/review` calls and the 0–9 → 0–100 normalization, keeping the page component thin.

- [ ] **Step 1: Create the module**

```ts
import {
  part2ReviewSchema,
  part2FollowUpSchema,
  part2FollowUpFeedbackSchema,
  toJsonSchema,
} from "./ai-schemas";
import { recordCost } from "./cost-tracker";
import type { Part2Review } from "./types";

// IELTS 0-9 band -> app's 0-100 scale. band 9 => 100.
const bandTo100 = (band: number): number =>
  Math.round(Math.max(0, Math.min(100, (band / 9) * 100)));

const SCORING_SYSTEM_PROMPT = [
  "You are an experienced IELTS Speaking examiner scoring a Part 2 long-turn monologue.",
  "Score STRICTLY on the four official IELTS band descriptors, each 0-9 (0.5 steps allowed):",
  "Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation.",
  "IMPORTANT: the transcript is what the candidate actually said, transcribed faithfully including any mistakes.",
  "Score it AS SPOKEN. Do NOT mentally correct errors before scoring; the errors are the signal.",
  "For Pronunciation you only have the transcript, not the audio — infer conservatively from spelling/phonetic hints and keep this score cautious.",
  "Also return an overall bandEstimate (0-9).",
  "errors: concrete grammar/word errors the candidate made, with the corrected form and a short explanation.",
  "improvements: phrasings that were understandable but could be more natural/advanced.",
  "highlights: things the candidate did well.",
  "newVocabulary: useful words/phrases worth learning (dictionary lemma form).",
  "Return empty arrays (never omit fields) when a category has nothing.",
].join(" ");

const postReview = async <T>(body: {
  prompt: string;
  system: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}): Promise<T> => {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, disableThinking: true }),
  });
  if (!res.ok) throw new Error(`Review request failed (${res.status})`);
  const data = (await res.json()) as {
    object?: T;
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
  };
  if (!data.object) throw new Error("Empty response from review service");
  if (data.usage && data.model) {
    recordCost({
      model: data.model,
      inputTokens: data.usage.inputTokens ?? 0,
      outputTokens: data.usage.outputTokens ?? 0,
      module: "ielts-part2",
    });
  }
  return data.object;
};

export const scorePart2Monologue = async (
  topic: string,
  bullets: string[],
  transcript: string
): Promise<Part2Review> => {
  const prompt = [
    `Cue card topic: ${topic}`,
    `Points the candidate should cover: ${bullets.join("; ")}`,
    "",
    "Candidate's monologue (verbatim transcript):",
    transcript,
  ].join("\n");

  const raw = await postReview<{
    scores: {
      fluencyCoherence: number;
      lexicalResource: number;
      grammaticalRange: number;
      pronunciation: number;
    };
    bandEstimate: number;
    errors: Part2Review["errors"];
    improvements: Part2Review["improvements"];
    highlights: Part2Review["highlights"];
    newVocabulary: Part2Review["newVocabulary"];
  }>({
    prompt,
    system: SCORING_SYSTEM_PROMPT,
    schema: toJsonSchema(part2ReviewSchema),
    maxOutputTokens: 8192,
  });

  return {
    scores: {
      fluencyCoherence: bandTo100(raw.scores.fluencyCoherence),
      lexicalResource: bandTo100(raw.scores.lexicalResource),
      grammaticalRange: bandTo100(raw.scores.grammaticalRange),
      pronunciation: bandTo100(raw.scores.pronunciation),
    },
    bandEstimate: raw.bandEstimate,
    errors: raw.errors,
    improvements: raw.improvements,
    highlights: raw.highlights,
    newVocabulary: raw.newVocabulary,
    followUpFeedback: "",
  };
};

export const generateFollowUps = async (
  topic: string,
  transcript: string
): Promise<string[]> => {
  const prompt = [
    "You are an IELTS examiner. The candidate just gave this Part 2 monologue.",
    `Topic: ${topic}`,
    "Monologue:",
    transcript,
    "",
    "Ask 1-2 short, natural follow-up questions on the same topic (as an examiner transitioning toward Part 3).",
  ].join("\n");
  const out = await postReview<{ questions: string[] }>({
    prompt,
    system: "Generate short IELTS-style spoken follow-up questions.",
    schema: toJsonSchema(part2FollowUpSchema),
    maxOutputTokens: 512,
  });
  return out.questions.slice(0, 2);
};

export const reviewFollowUpAnswers = async (
  topic: string,
  qa: Array<{ question: string; answer: string }>
): Promise<string> => {
  const prompt = [
    `Topic: ${topic}`,
    "The candidate answered these follow-up questions (verbatim transcripts):",
    ...qa.map((x, i) => `Q${i + 1}: ${x.question}\nA${i + 1}: ${x.answer}`),
    "",
    "Give one short paragraph of feedback on the follow-up answers (fluency, relevance, any notable errors). Keep it concise.",
  ].join("\n");
  const out = await postReview<{ feedback: string }>({
    prompt,
    system: "You are an IELTS examiner giving brief, encouraging, concrete feedback.",
    schema: toJsonSchema(part2FollowUpFeedbackSchema),
    maxOutputTokens: 1024,
  });
  return out.feedback;
};
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/ielts-part2-review.ts --quiet`
Expected: no errors.

- [ ] **Step 3: Commit** (human runs/approves)

```bash
git add lib/ielts-part2-review.ts
git commit -m "feat(ielts): add Part 2 scoring and follow-up helpers"
```

---

### Task 5: Prep/Speaking timers hook

**Files:**
- Create: `lib/use-countdown.ts`

**Interfaces:**
- Produces:
  - `useCountdown(seconds: number, onDone: () => void, running: boolean): { remaining: number; }` — counts DOWN from `seconds` while `running`, calls `onDone` once at 0.
  - `useStopwatch(running: boolean, capSeconds: number, onCap: () => void): { elapsed: number; }` — counts UP while `running`, calls `onCap` once when it reaches `capSeconds`.

Isolating timers keeps the page's effects simple and avoids the interval-leak bugs common in inline timer code.

- [ ] **Step 1: Create the hook file**

```ts
import { useEffect, useRef, useState } from "react";

// Counts down from `seconds` while `running` is true. Fires `onDone` exactly
// once when it reaches 0. Cleans up its interval on unmount / running=false.
export const useCountdown = (
  seconds: number,
  onDone: () => void,
  running: boolean
): { remaining: number } => {
  const [remaining, setRemaining] = useState(seconds);
  const firedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!running) return;
    firedRef.current = false;
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          if (!firedRef.current) {
            firedRef.current = true;
            onDoneRef.current();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, seconds]);

  return { remaining };
};

// Counts up while `running`. Fires `onCap` once at `capSeconds`.
export const useStopwatch = (
  running: boolean,
  capSeconds: number,
  onCap: () => void
): { elapsed: number } => {
  const [elapsed, setElapsed] = useState(0);
  const firedRef = useRef(false);
  const onCapRef = useRef(onCap);
  onCapRef.current = onCap;

  useEffect(() => {
    if (!running) return;
    firedRef.current = false;
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + 1;
        if (next >= capSeconds && !firedRef.current) {
          firedRef.current = true;
          onCapRef.current();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, capSeconds]);

  return { elapsed };
};
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/use-countdown.ts --quiet`
Expected: no errors.

- [ ] **Step 3: Commit** (human runs/approves)

```bash
git add lib/use-countdown.ts
git commit -m "feat(ielts): add countdown/stopwatch timer hooks"
```

---

### Task 6: Part 2 landing page

**Files:**
- Create: `app/ielts/part2/page.tsx`

**Interfaces:**
- Consumes: `pickRandomCard` (Task 1). Reads `node_modules/next/dist/docs/` for routing/navigation APIs before writing.
- Produces: a route at `/ielts/part2` that shows a random cue card preview and a "Start" button that navigates to `/ielts/part2/<uuid>?card=<cardId>`.

- [ ] **Step 1: Read the forked Next routing docs**

Read the relevant file(s) under `node_modules/next/dist/docs/` for client navigation (`useRouter`, route params, search params) to confirm the API in this fork before coding.

- [ ] **Step 2: Create the landing page**

Client component: pick a random card on mount, show topic + 4 bullets, a "Start Part 2" button that generates a `crypto.randomUUID()` session id and pushes `/ielts/part2/${id}?card=${card.id}`, and a link to history (`/history` or a Part 2 filter — reuse existing history route). Persist last-seen card id to `localStorage` (`ielts-part2-last-card`) so the next landing avoids an immediate repeat. Follow the visual patterns of existing landing pages (e.g. `app/conversation/page.tsx`) for layout/Button usage.

- [ ] **Step 3: Type-check, lint, manual verify**

Run: `npx tsc --noEmit && npx eslint app/ielts/part2/page.tsx --quiet`
Manual: visit `/ielts/part2`, confirm a cue card renders with exactly 4 bullets and "Start" navigates to the session URL with a uuid + `?card=`.

- [ ] **Step 4: Commit** (human runs/approves)

```bash
git add app/ielts/part2/page.tsx
git commit -m "feat(ielts): add Part 2 landing page"
```

---

### Task 7: Part 2 session state machine + prep/speaking phases

**Files:**
- Create: `app/ielts/part2/[id]/page.tsx`

**Interfaces:**
- Consumes: `pickRandomCard`/`PART2_CARDS` (Task 1), `useCountdown`/`useStopwatch` (Task 5), `startRecording` + `RecordingSession` + `isRecordingSupported` (`lib/speech.ts`), `speakStream`/`stopSpeaking` (`lib/tts.ts`).
- Produces: the session page implementing phases `prep` and `speaking` (transcribing/scoring/followup/done added in Tasks 8–9). Reads `?card=` search param to resolve the card from `PART2_CARDS` (fallback to `pickRandomCard()` if missing/unknown).

**Phase enum (single source of truth):**
```ts
type Part2Phase =
  | "prep" | "speaking" | "transcribing" | "scoring" | "followup" | "done";
```

- [ ] **Step 1: Read forked Next docs for search params / dynamic route params.**

- [ ] **Step 2: Scaffold the page with the phase machine (prep + speaking)**

- Resolve card from `?card=`; if unknown, `pickRandomCard()`.
- `phase` starts at `"prep"`. Render cue card (topic + 4 bullets) throughout.
- **prep**: `useCountdown(60, () => startSpeaking(), phase === "prep")`; show remaining seconds; a notes `<Textarea>` (local state only, never sent anywhere); an "I'm ready" button that calls `startSpeaking()` early.
- Optional "Read card aloud" toggle using `speakStream(topic + bullets)`; off by default; `stopSpeaking()` on unmount/leaving prep.
- `startSpeaking()`: guard against double-entry (`startingRef`), call `startRecording()`, store the `RecordingSession` in a ref, set `phase = "speaking"`.
- **speaking**: `useStopwatch(phase === "speaking", 120, () => stopSpeaking2())` where `stopSpeaking2` triggers the stop→transcribe path (Task 8). Show elapsed mm:ss with a 2:00 ceiling label. "Stop" button enabled only after `elapsed >= 30`.
- Mic permission errors: show an actionable message and keep the user in prep.
- On unmount: cancel any active `RecordingSession` and `stopSpeaking()`.

Use `isRecordingSupported()` to gate the whole flow with a "voice not supported" message, mirroring the conversation page.

- [ ] **Step 3: Type-check, lint, manual verify**

Run: `npx tsc --noEmit && npx eslint "app/ielts/part2/[id]/page.tsx" --quiet`
Manual: from landing → Start, confirm 60s countdown runs, notes are editable, "I'm ready" starts recording, the stopwatch counts up, "Stop" is disabled before 30s and enabled after, and the mic actually records (browser mic indicator on).

- [ ] **Step 4: Commit** (human runs/approves)

```bash
git add "app/ielts/part2/[id]/page.tsx"
git commit -m "feat(ielts): Part 2 session prep + speaking phases"
```

---

### Task 8: Transcription + scoring phases

**Files:**
- Modify: `app/ielts/part2/[id]/page.tsx`

**Interfaces:**
- Consumes: `scorePart2Monologue` (Task 4), `db` (`lib/db`), `dbHelpers` (`lib/db-helpers`), `Part2Session`/`Part2Review` (Task 2).
- Produces: `transcribing` and `scoring` phase behavior; persists a `Part2Session` row.

- [ ] **Step 1: Implement stop → transcribe → score**

- `stopSpeaking2()`: set `phase = "transcribing"`, `await session.stop()` (returns `{ text, approximate }`).
- Guard: if transcript word count < 10, show "That was very short — try recording again" and offer re-record (return to `speaking` with a fresh `startRecording()`, NOT re-running the 60s prep).
- On transcript success: capture `durationSec` (the stopwatch elapsed at stop), set `phase = "scoring"`, call `scorePart2Monologue(topic, bullets, transcript)`.
- On scoring success: build the `Part2Session` (with `review`, empty `followUps`, `followUpFeedback` still `""`), `await db.part2Sessions.put(session)`, then set `phase = "followup"` (Task 9). If follow-ups are disabled/empty, go straight to `"done"`.
- Error handling:
  - Transcription failure after `lib/speech.ts`'s own fallback/retry: keep phase recoverable, show "Couldn't transcribe — re-record", offer re-record.
  - Scoring failure: persist the session WITH transcript and `review: null`, show the transcript, and offer a "Retry scoring" button (re-invokes `scorePart2Monologue`). Never lose the monologue.
- `beforeunload` warning while a session is in progress and unscored (reuse the conversation page's pattern).

- [ ] **Step 2: Type-check, lint, manual verify**

Run: `npx tsc --noEmit && npx eslint "app/ielts/part2/[id]/page.tsx" --quiet`
Manual: record a ~30–60s monologue with a couple of deliberate grammar mistakes; confirm "Transcribing…" then "Scoring…" appear, the transcript shows the mistakes faithfully (not silently corrected), and four band sub-scores + an overall band estimate render. Confirm a row appears in `part2Sessions` in IndexedDB.

- [ ] **Step 3: Commit** (human runs/approves)

```bash
git add "app/ielts/part2/[id]/page.tsx"
git commit -m "feat(ielts): Part 2 transcription + scoring phases"
```

---

### Task 9: Follow-up phase + results (`done`)

**Files:**
- Modify: `app/ielts/part2/[id]/page.tsx`

**Interfaces:**
- Consumes: `generateFollowUps`, `reviewFollowUpAnswers` (Task 4), `startRecording` (`lib/speech.ts`), `db` (`lib/db`).
- Produces: `followup` and `done` phase behavior; updates the persisted session with `followUps` + `followUpFeedback`.

- [ ] **Step 1: Implement follow-up loop**

- On entering `followup`: call `generateFollowUps(topic, transcript)` → 1–2 questions.
- For each question in turn: display it (optional TTS read-aloud), let the user record an answer via `startRecording()` (reuse the same record/stop/transcribe UI as the monologue, minus the 2:00 cap), transcribe, store `{ question, answer }`.
- After the last answer: `reviewFollowUpAnswers(topic, followUps)` → `followUpFeedback`; `await db.part2Sessions.update(id, { followUps, review: { ...review, followUpFeedback } })`; set `phase = "done"`.
- If `generateFollowUps` fails: skip follow-ups (log, go straight to `done`) — follow-ups are enrichment, not core.

- [ ] **Step 2: Implement the `done` results view**

- Headline: overall **IELTS band estimate (0–9)** prominently.
- Four sub-scores (0–100) with labels: Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation. **Pronunciation is labeled "estimate — inferred from transcript, not audio".**
- Sections: errors (original → corrected + explanation), improvements, highlights, follow-up feedback.
- New vocabulary with an "Add to review cards" action reusing the existing SRS-add pattern from `app/conversation/[id]/review/page.tsx` (same `db.cards` shape / helper).
- "Practice another" button → `/ielts/part2`.

- [ ] **Step 3: Type-check, lint, manual verify**

Run: `npx tsc --noEmit && npx eslint "app/ielts/part2/[id]/page.tsx" --quiet`
Manual: complete a full round; confirm 1–2 follow-up questions appear, each answerable by voice, a combined follow-up feedback shows, the results view renders all sections, the Pronunciation caveat is visible, and "Add to review cards" creates an SRS card. Reload the page mid-`done` and confirm the persisted session still renders (restore path).

- [ ] **Step 4: Commit** (human runs/approves)

```bash
git add "app/ielts/part2/[id]/page.tsx"
git commit -m "feat(ielts): Part 2 follow-ups + results view"
```

---

### Task 10: Session restore + nav entry

**Files:**
- Modify: `app/ielts/part2/[id]/page.tsx` (restore-on-mount)
- Modify: `components/sidebar-nav.tsx` (nav item)

**Interfaces:**
- Consumes: `db.part2Sessions` (Task 3).
- Produces: refresh-safe session page; a sidebar link to `/ielts/part2`.

- [ ] **Step 1: Restore on mount**

On mount, `await db.part2Sessions.get(id)`. If a session exists with a `review`, jump straight to `phase = "done"` and render it (deep-link / refresh to a finished session must not restart the flow or clobber it). If it exists without a review (interrupted after transcript), restore the transcript and land on `scoring` with a "Retry scoring" affordance.

- [ ] **Step 2: Add the sidebar nav item**

In `components/sidebar-nav.tsx`, import an appropriate `lucide-react` icon (e.g. `Mic` or `GraduationCap`) and add to `NAV_ITEMS`:

```ts
{ title: "IELTS Part 2", href: "/ielts/part2", icon: GraduationCap },
```

(Place it near "Conversation" / "Listening" so speaking practice groups together.)

- [ ] **Step 3: Type-check, lint, manual verify**

Run: `npx tsc --noEmit && npx eslint "app/ielts/part2/[id]/page.tsx" components/sidebar-nav.tsx --quiet`
Manual: sidebar shows "IELTS Part 2" and routes correctly; finish a session, refresh — it restores to results, not a fresh prep.

- [ ] **Step 4: Commit** (human runs/approves)

```bash
git add "app/ielts/part2/[id]/page.tsx" components/sidebar-nav.tsx
git commit -m "feat(ielts): Part 2 session restore + sidebar nav entry"
```

---

## Self-Review

**Spec coverage:** cue card + 4 bullets (T1), 60s prep + notes (T7), 1–2 min monologue w/ 2:00 cap (T7), one-shot transcription (T8), IELTS 4-band scoring + corrections (T2/T4/T8), 1–2 voice follow-ups (T9), results w/ pronunciation caveat (T9), persistence + restore (T3/T8/T10), reuse of speech/tts/review/SRS (T4/T7/T8/T9), nav entry (T10), faithful transcription preserved (T4 prompt + reused Whisper path). All spec sections map to a task.

**Placeholder scan:** no TBD/TODO; all code steps carry full code; error-handling steps specify exact behavior (word-count guard, retry-scoring, skip-follow-ups), not "handle errors".

**Type consistency:** `Part2Card`, `Part2Session`, `Part2Review`, `part2ReviewSchema`, `part2FollowUpSchema`, `part2FollowUpFeedbackSchema`, `pickRandomCard`, `scorePart2Monologue`, `generateFollowUps`, `reviewFollowUpAnswers`, `useCountdown`, `useStopwatch` are named identically across the tasks that define and consume them. Scores stored 0–100 via `bandTo100`; overall band kept 0–9. `module: "ielts-part2"` used consistently in cost tracking.
```
