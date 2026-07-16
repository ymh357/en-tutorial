# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Next.js project scaffold, database layer (Dexie.js/IndexedDB), AI service layer (0G API via Vercel AI SDK), global state (Zustand), app shell layout, settings page, and onboarding flow — providing the complete foundation for all feature modules.

**Architecture:** Next.js 16 App Router with server-side Route Handlers for AI API calls. Client-side IndexedDB (Dexie.js) for all persistent data. Zustand stores for ephemeral UI state. shadcn/ui component library for consistent design. The app shell provides sidebar navigation, theme support, and responsive layout.

**Tech Stack:** Next.js 16.2.x, React 19.2.x, TypeScript 5.x strict, Tailwind CSS 4.3.x, shadcn/ui 4.13.x, Vercel AI SDK 7.x (`ai`, `@ai-sdk/openai-compatible`), Dexie.js 4.4.x, Zustand 5.x

## Global Constraints

- Node.js 22+
- TypeScript strict mode: explicit types at module boundaries, inferred locally
- All AI calls go through Next.js Route Handlers (API key never exposed to client)
- All persistent data in IndexedDB via Dexie.js (no external database)
- English-only code comments
- No emoji in UI unless user-configured
- Desktop-first layout (no mobile optimization in v1)
- Use `const` arrow functions for React component definitions
- Functional components and hooks only

## File Structure

```
en-tutorial/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Dashboard (placeholder for Phase 3)
│   ├── globals.css             # Tailwind imports + custom tokens
│   ├── onboarding/
│   │   └── page.tsx            # First-launch onboarding flow
│   ├── settings/
│   │   └── page.tsx            # Settings page
│   └── api/
│       ├── chat/
│       │   └── route.ts        # AI chat completion endpoint
│       ├── review/
│       │   └── route.ts        # AI review (session/writing) endpoint
│       └── extract/
│           └── route.ts        # URL article extraction endpoint
├── lib/
│   ├── db.ts                   # Dexie database definition + schema
│   ├── db-helpers.ts           # Query helpers (computed aggregates, SRS queries)
│   ├── ai.ts                   # AI provider configuration
│   ├── srs-algorithm.ts        # SM-2 algorithm implementation
│   ├── frequency-list.ts       # Top 5000 English words with CEFR tags
│   └── types.ts                # Shared TypeScript types
├── stores/
│   └── app-store.ts            # Zustand store (UI state, onboarding status)
├── components/
│   ├── app-shell.tsx           # Sidebar + top bar + main content area
│   ├── sidebar-nav.tsx         # Navigation sidebar
│   └── providers.tsx           # Client-side providers wrapper
├── hooks/
│   └── use-db.ts               # React hooks for Dexie queries
├── .env.local                  # OG_API_KEY, OG_API_BASE_URL
├── next.config.ts              # Next.js configuration
├── tailwind.config.ts          # Tailwind configuration (if needed for v4)
├── tsconfig.json               # TypeScript configuration
└── package.json
```

---

### Task 1: Project Scaffold + Dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `app/globals.css`
- Create: `.env.local`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: working Next.js dev server, all dependencies installed

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/minghao/en-tutorial
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack --yes
```

Expected: Project scaffolded with Next.js 16.x, creates `app/`, `public/`, `package.json`, `tsconfig.json`, etc.

- [ ] **Step 2: Install additional dependencies**

```bash
npm install ai @ai-sdk/openai-compatible dexie zustand
npm install -D @types/node
```

- [ ] **Step 3: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

Select: New York style, Zinc base color, CSS variables enabled.

- [ ] **Step 4: Add shadcn components needed for Phase 1**

```bash
npx shadcn@latest add button card input label select separator sheet sidebar tooltip badge tabs textarea dialog alert scroll-area
```

- [ ] **Step 5: Create `.env.local`**

```bash
# Create .env.local with placeholder values
```

Write `.env.local`:

```
OG_API_KEY=your-api-key-here
OG_API_BASE_URL=https://router-api.0g.ai/v1
OG_DEFAULT_MODEL=deepseek-ai/DeepSeek-V4-Flash
OG_QUALITY_MODEL=anthropic/claude-sonnet-5
```

- [ ] **Step 6: Update `.gitignore`**

Append to the generated `.gitignore`:

```
.env.local
.env*.local
```

- [ ] **Step 7: Configure TypeScript strict mode**

Verify `tsconfig.json` has `"strict": true`. If not, add it under `compilerOptions`.

- [ ] **Step 8: Verify dev server starts**

```bash
npm run dev
```

Expected: Server starts on `http://localhost:3000`, default Next.js page renders.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js 16 project with all dependencies"
```

---

### Task 2: TypeScript Types

**Files:**
- Create: `lib/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: all shared types used by every subsequent task — `Card`, `Conversation`, `ConversationMessage`, `ConversationReview`, `ReadingSession`, `WritingSession`, `WritingAnnotation`, `LearningProfile`, `DailyStats`, `CardType`, `CardSource`, `MasteryLevel`, `ScenarioType`, `WritingTaskType`

- [ ] **Step 1: Write type definitions**

Create `lib/types.ts`:

```typescript
export type CardType = "vocabulary" | "error" | "expression";
export type CardSource = "conversation" | "reading" | "writing" | "manual";
export type MasteryLevel = "new" | "learning" | "familiar" | "mastered";
export type ScenarioType = "preset" | "custom" | "free" | "recommended";
export type WritingTaskType =
  | "email"
  | "essay"
  | "social"
  | "report"
  | "quick"
  | "free";
export type AnnotationType = "error" | "suggestion" | "style" | "positive";
export type ErrorTrend = "improving" | "stable" | "declining";

export interface Card {
  id: string;
  type: CardType;
  lemma: string;
  front: string;
  back: string;
  context: string;
  source: CardSource;
  sourceId: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReview: Date;
  masteryLevel: MasteryLevel;
  createdAt: Date;
  lastReviewedAt: Date | null;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ConversationReview {
  scores: {
    fluency: number;
    accuracy: number;
    vocabulary: number;
    complexity: number;
  };
  errors: Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>;
  improvements: Array<{
    original: string;
    improved: string;
    context: string;
  }>;
  highlights: Array<{
    text: string;
    reason: string;
  }>;
  newVocabulary: Array<{
    word: string;
    lemma: string;
    definition: string;
    example: string;
  }>;
}

export interface Conversation {
  id: string;
  scenario: string;
  scenarioType: ScenarioType;
  messages: ConversationMessage[];
  review: ConversationReview | null;
  duration: number;
  createdAt: Date;
}

export interface ReadingLookup {
  word: string;
  lemma: string;
  definition: string;
  position: number;
}

export interface ReadingSession {
  id: string;
  title: string;
  content: string;
  source: "ai_generated" | "pasted" | "url";
  sourceUrl?: string;
  difficulty: string;
  lookups: ReadingLookup[];
  sentenceAnalyses: Array<{ sentence: string; analysis: string }>;
  vocabCoverage: number;
  duration: number;
  createdAt: Date;
}

export interface WritingAnnotation {
  type: AnnotationType;
  start: number;
  end: number;
  original: string;
  replacement: string;
  explanation: string;
}

export interface WritingReview {
  score: number;
  annotations: WritingAnnotation[];
  polishedVersion: string;
  errorPatterns: Array<{ category: string; description: string }>;
}

export interface WritingSession {
  id: string;
  taskType: WritingTaskType;
  taskPrompt: string;
  content: string;
  wordCount: number;
  review: WritingReview | null;
  createdAt: Date;
}

export interface LearningProfile {
  id: "singleton";
  streakCurrent: number;
  streakLongest: number;
  lastActiveDate: string | null;
  milestones: Array<{ id: string; earnedAt: Date }>;
  initialCefrLevel: string;
  knownWordsBase: string[];
}

export interface DailyStats {
  id: string;
  wordsLearned: number;
  errorsFixed: number;
  conversationCount: number;
  readingCount: number;
  writingCount: number;
  srsReviewed: number;
  timeSpent: number;
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add shared TypeScript type definitions"
```

---

### Task 3: Database Layer (Dexie.js)

**Files:**
- Create: `lib/db.ts`
- Create: `lib/db-helpers.ts`

**Interfaces:**
- Consumes: all types from `lib/types.ts` — `Card`, `Conversation`, `ReadingSession`, `WritingSession`, `LearningProfile`, `DailyStats`
- Produces: `db` (Dexie instance with typed tables), `dbHelpers` object with methods:
  - `getProfile(): Promise<LearningProfile>`
  - `initProfile(cefrLevel: string, knownWords: string[]): Promise<void>`
  - `getDueCards(limit?: number): Promise<Card[]>`
  - `getCardByLemma(lemma: string): Promise<Card | undefined>`
  - `getTodayStats(): Promise<DailyStats>`
  - `updateTodayStats(updates: Partial<DailyStats>): Promise<void>`
  - `incrementTodayStat(field: keyof DailyStats, amount?: number): Promise<void>`
  - `getStatsRange(startDate: string, endDate: string): Promise<DailyStats[]>`
  - `getVocabCounts(): Promise<Record<MasteryLevel, number>>`
  - `isWordKnown(lemma: string): Promise<boolean>`
  - `updateStreak(): Promise<{ current: number; longest: number }>`

- [ ] **Step 1: Write Dexie database definition**

Create `lib/db.ts`:

```typescript
import Dexie, { type EntityTable } from "dexie";
import type {
  Card,
  Conversation,
  ReadingSession,
  WritingSession,
  LearningProfile,
  DailyStats,
} from "./types";

const db = new Dexie("EnTutorDB") as Dexie & {
  cards: EntityTable<Card, "id">;
  conversations: EntityTable<Conversation, "id">;
  readingSessions: EntityTable<ReadingSession, "id">;
  writingSessions: EntityTable<WritingSession, "id">;
  learningProfile: EntityTable<LearningProfile, "id">;
  dailyStats: EntityTable<DailyStats, "id">;
};

db.version(1).stores({
  cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
  conversations: "id, scenarioType, createdAt",
  readingSessions: "id, source, createdAt",
  writingSessions: "id, taskType, createdAt",
  learningProfile: "id",
  dailyStats: "id",
});

export { db };
```

- [ ] **Step 2: Write database helper functions**

Create `lib/db-helpers.ts`:

```typescript
import { db } from "./db";
import type {
  Card,
  DailyStats,
  LearningProfile,
  MasteryLevel,
} from "./types";

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const today = (): string => formatDate(new Date());

const DEFAULT_PROFILE: LearningProfile = {
  id: "singleton",
  streakCurrent: 0,
  streakLongest: 0,
  lastActiveDate: null,
  milestones: [],
  initialCefrLevel: "",
  knownWordsBase: [],
};

export const dbHelpers = {
  async getProfile(): Promise<LearningProfile> {
    const profile = await db.learningProfile.get("singleton");
    return profile ?? DEFAULT_PROFILE;
  },

  async initProfile(
    cefrLevel: string,
    knownWords: string[]
  ): Promise<void> {
    await db.learningProfile.put({
      ...DEFAULT_PROFILE,
      initialCefrLevel: cefrLevel,
      knownWordsBase: knownWords,
    });
  },

  async getDueCards(limit: number = 50): Promise<Card[]> {
    const now = new Date();
    return db.cards
      .where("nextReview")
      .belowOrEqual(now)
      .limit(limit)
      .toArray();
  },

  async getCardByLemma(lemma: string): Promise<Card | undefined> {
    return db.cards.where("lemma").equals(lemma).first();
  },

  async getTodayStats(): Promise<DailyStats> {
    const id = today();
    const existing = await db.dailyStats.get(id);
    if (existing) return existing;
    const empty: DailyStats = {
      id,
      wordsLearned: 0,
      errorsFixed: 0,
      conversationCount: 0,
      readingCount: 0,
      writingCount: 0,
      srsReviewed: 0,
      timeSpent: 0,
    };
    return empty;
  },

  async updateTodayStats(updates: Partial<DailyStats>): Promise<void> {
    const id = today();
    const existing = await db.dailyStats.get(id);
    if (existing) {
      await db.dailyStats.update(id, updates);
    } else {
      await db.dailyStats.put({
        id,
        wordsLearned: 0,
        errorsFixed: 0,
        conversationCount: 0,
        readingCount: 0,
        writingCount: 0,
        srsReviewed: 0,
        timeSpent: 0,
        ...updates,
      });
    }
  },

  async incrementTodayStat(
    field: keyof Omit<DailyStats, "id">,
    amount: number = 1
  ): Promise<void> {
    const stats = await this.getTodayStats();
    const current = (stats[field] as number) ?? 0;
    await this.updateTodayStats({ [field]: current + amount });
  },

  async getStatsRange(
    startDate: string,
    endDate: string
  ): Promise<DailyStats[]> {
    return db.dailyStats
      .where("id")
      .between(startDate, endDate, true, true)
      .toArray();
  },

  async getVocabCounts(): Promise<Record<MasteryLevel, number>> {
    const counts: Record<MasteryLevel, number> = {
      new: 0,
      learning: 0,
      familiar: 0,
      mastered: 0,
    };
    await db.cards.each((card) => {
      counts[card.masteryLevel]++;
    });
    return counts;
  },

  async isWordKnown(lemma: string): Promise<boolean> {
    const profile = await this.getProfile();
    if (profile.knownWordsBase.includes(lemma)) return true;
    const card = await this.getCardByLemma(lemma);
    return card?.masteryLevel === "mastered";
  },

  async updateStreak(): Promise<{ current: number; longest: number }> {
    const profile = await this.getProfile();
    const todayStr = today();

    if (profile.lastActiveDate === todayStr) {
      return {
        current: profile.streakCurrent,
        longest: profile.streakLongest,
      };
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday);

    let newCurrent: number;
    if (profile.lastActiveDate === yesterdayStr) {
      newCurrent = profile.streakCurrent + 1;
    } else {
      newCurrent = 1;
    }

    const newLongest = Math.max(newCurrent, profile.streakLongest);

    await db.learningProfile.update("singleton", {
      streakCurrent: newCurrent,
      streakLongest: newLongest,
      lastActiveDate: todayStr,
    });

    return { current: newCurrent, longest: newLongest };
  },
};
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts lib/db-helpers.ts
git commit -m "feat: add Dexie.js database layer with typed tables and helpers"
```

---

### Task 4: SM-2 Algorithm

**Files:**
- Create: `lib/srs-algorithm.ts`

**Interfaces:**
- Consumes: `Card`, `MasteryLevel` from `lib/types.ts`
- Produces:
  - `type Rating = 0 | 1 | 2 | 3`
  - `ratingLabels: Record<Rating, string>` — `{0: "Again", 1: "Hard", 2: "Good", 3: "Easy"}`
  - `computeNextReview(card: Card, rating: Rating): { easeFactor: number; interval: number; repetitions: number; nextReview: Date; masteryLevel: MasteryLevel }`
  - `getNextIntervals(card: Card): Record<Rating, number>` — preview intervals for each rating button

- [ ] **Step 1: Implement SM-2 algorithm**

Create `lib/srs-algorithm.ts`:

```typescript
import type { Card, MasteryLevel } from "./types";

export type Rating = 0 | 1 | 2 | 3;

export const ratingLabels: Record<Rating, string> = {
  0: "Again",
  1: "Hard",
  2: "Good",
  3: "Easy",
};

const MINIMUM_EASE = 1.3;

const computeMasteryLevel = (
  interval: number,
  repetitions: number
): MasteryLevel => {
  if (repetitions === 0) return "new";
  if (interval < 7) return "learning";
  if (interval < 30) return "familiar";
  if (repetitions >= 3) return "mastered";
  return "familiar";
};

export const computeNextReview = (
  card: Card,
  rating: Rating
): {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReview: Date;
  masteryLevel: MasteryLevel;
} => {
  let { easeFactor, interval, repetitions } = card;

  if (rating === 0) {
    repetitions = 0;
    interval = 0.0007; // ~1 minute in days
  } else if (rating === 1) {
    // Hard: keep current interval, reduce ease
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.15);
    if (repetitions === 0) {
      interval = 0.007; // ~10 minutes
    } else {
      interval = Math.max(1, interval * 1.2);
    }
    repetitions += 1;
  } else if (rating === 2) {
    // Good: normal progression
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.05 + 0.1);
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    // Easy: accelerated progression
    easeFactor = Math.max(MINIMUM_EASE, easeFactor + 0.15);
    if (repetitions === 0) {
      interval = 4;
    } else {
      interval = Math.round(interval * easeFactor * 1.3);
    }
    repetitions += 1;
  }

  const nextReview = new Date();
  nextReview.setTime(nextReview.getTime() + interval * 24 * 60 * 60 * 1000);

  const masteryLevel = computeMasteryLevel(interval, repetitions);

  return { easeFactor, interval, repetitions, nextReview, masteryLevel };
};

export const getNextIntervals = (card: Card): Record<Rating, number> => {
  const results: Record<Rating, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const r of [0, 1, 2, 3] as Rating[]) {
    results[r] = computeNextReview(card, r).interval;
  }
  return results;
};
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/srs-algorithm.ts
git commit -m "feat: implement SM-2 spaced repetition algorithm"
```

---

### Task 5: Frequency Word List

**Files:**
- Create: `lib/frequency-list.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2"`
  - `getKnownWordsForLevel(level: CefrLevel): string[]` — returns all lemmas at or below the given CEFR level
  - `getWordLevel(lemma: string): CefrLevel | null` — returns the CEFR level of a word, or null if not in the list

- [ ] **Step 1: Create frequency list module**

Create `lib/frequency-list.ts`:

This file contains a curated subset of the top 5000 English words tagged by CEFR level. The full list is large; we store it as a compact structure.

```typescript
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Compact representation: each level maps to a comma-separated string of lemmas.
// At runtime we split on demand. This keeps the source file manageable.
// In production, this would be loaded from a JSON asset; for v1 we inline a
// representative set per level and expand later.
const WORDS_BY_LEVEL: Record<CefrLevel, string[]> = {
  A1: [
    "be", "have", "do", "say", "go", "get", "make", "know", "think", "take",
    "see", "come", "want", "use", "find", "give", "tell", "work", "call", "try",
    "ask", "need", "feel", "become", "leave", "put", "mean", "keep", "let", "begin",
    "show", "hear", "play", "run", "move", "live", "believe", "bring", "happen", "write",
    "sit", "stand", "lose", "pay", "meet", "include", "continue", "set", "learn", "change",
    "lead", "understand", "watch", "follow", "stop", "create", "speak", "read", "spend", "grow",
    "open", "walk", "win", "teach", "offer", "remember", "love", "consider", "appear", "buy",
    "wait", "serve", "die", "send", "build", "stay", "fall", "cut", "reach", "kill",
    "remain", "suggest", "raise", "pass", "sell", "require", "report", "decide", "pull", "eat",
    // Common nouns
    "time", "year", "people", "way", "day", "man", "woman", "child", "world", "life",
    "hand", "part", "place", "case", "week", "company", "system", "program", "question", "work",
    "number", "night", "point", "home", "water", "room", "mother", "area", "money", "story",
    "fact", "month", "lot", "right", "study", "book", "eye", "job", "word", "business",
    "issue", "side", "kind", "head", "house", "friend", "father", "power", "hour", "game",
    "line", "end", "member", "city", "community", "name", "president", "team", "minute", "idea",
    "body", "back", "parent", "face", "other", "level", "office", "door", "health", "person",
    "art", "war", "history", "party", "result", "car", "morning", "food", "school", "family",
    // Common adjectives
    "good", "new", "first", "last", "long", "great", "little", "own", "old", "right",
    "big", "high", "different", "small", "large", "next", "early", "young", "important", "few",
    "public", "bad", "same", "able", "free", "sure", "true", "full", "special", "easy",
    // Common adverbs, prepositions, etc.
    "not", "also", "very", "often", "however", "too", "usually", "really", "already", "always",
    "well", "just", "more", "still", "never", "now", "here", "then", "today", "there",
  ],
  A2: [
    "accept", "achieve", "add", "admit", "affect", "afford", "agree", "allow", "announce", "apply",
    "argue", "arrange", "arrive", "attack", "avoid", "base", "beat", "belong", "break", "burn",
    "cause", "check", "choose", "claim", "close", "collect", "compare", "compete", "complain", "complete",
    "connect", "contain", "control", "cook", "copy", "correct", "cost", "count", "cover", "cross",
    "cry", "damage", "deal", "deliver", "demand", "depend", "describe", "design", "destroy", "develop",
    "disappear", "discover", "discuss", "divide", "draw", "drive", "drop", "encourage", "enjoy", "enter",
    "examine", "exist", "expect", "experience", "explain", "express", "extend", "fail", "feed", "fight",
    "fill", "finish", "fit", "fix", "fly", "fold", "force", "forget", "forgive", "form",
    // A2 nouns
    "accident", "advantage", "advertisement", "advice", "age", "amount", "argument", "arrangement",
    "article", "attention", "bank", "bath", "beach", "behaviour", "birth", "blood", "board", "boat",
    "bone", "bottom", "brain", "breath", "bridge", "brother", "bus", "cake", "camera", "camp",
    "capital", "career", "ceiling", "centre", "century", "chance", "character", "choice", "circle",
    "class", "climate", "clothes", "club", "coast", "coffee", "cold", "colour", "competition",
    // A2 adjectives
    "afraid", "angry", "available", "basic", "beautiful", "boring", "brave", "bright", "busy", "calm",
    "careful", "central", "cheap", "clean", "clear", "clever", "cold", "comfortable", "common", "complete",
    "confident", "cool", "correct", "crazy", "creative", "cruel", "dangerous", "dark", "dead", "deep",
    "difficult", "dirty", "dry", "empty", "enormous", "entire", "equal", "excellent", "excited", "expensive",
  ],
  B1: [
    "absorb", "abuse", "access", "accommodate", "accompany", "account", "accumulate", "accuse", "acquire",
    "adapt", "adjust", "admire", "adopt", "advance", "advertise", "advocate", "aid", "aim", "allocate",
    "alter", "amaze", "amend", "analyze", "anticipate", "apologize", "appeal", "appoint", "appreciate",
    "approach", "approve", "arise", "assess", "assign", "assist", "associate", "assume", "assure", "attach",
    "attempt", "attend", "attract", "authorize", "ban", "bargain", "bear", "bend", "benefit", "bet",
    "bite", "blame", "bless", "block", "blow", "boast", "bother", "bounce", "bound", "broadcast",
    // B1 nouns
    "absence", "abundance", "academy", "accommodation", "accomplishment", "accuracy", "acquisition",
    "administration", "adolescent", "agenda", "agriculture", "alliance", "alternative", "ambition",
    "amendment", "analysis", "ancestor", "anxiety", "appliance", "application", "appreciation",
    "architect", "architecture", "aspect", "assembly", "assessment", "asset", "assignment",
    "assumption", "atmosphere", "authority", "awareness", "background", "balance", "barrier",
    // B1 adjectives
    "abstract", "academic", "acceptable", "accessible", "accurate", "active", "actual", "adequate",
    "administrative", "advanced", "aggressive", "alternative", "annual", "apparent", "appropriate",
    "ashamed", "attractive", "automatic", "awful", "awkward", "balanced", "bare", "bitter",
    "blind", "brief", "brilliant", "broad", "capable", "casual", "cautious", "characteristic",
  ],
  B2: [
    "abandon", "abolish", "abstain", "accelerate", "accomplish", "acknowledge", "activate", "adhere",
    "administer", "affirm", "aggravate", "align", "allege", "alleviate", "amid", "amplify",
    "annotate", "anticipate", "apparatus", "articulate", "ascertain", "aspire", "assemble",
    "assert", "attribute", "audit", "authenticate", "automate", "benchmark", "breach",
    "calibrate", "capitalize", "catalog", "cater", "cease", "certify", "champion", "characterize",
    "circulate", "clarify", "classify", "cluster", "coincide", "collaborate", "commemorate",
    // B2 nouns
    "abolition", "acceleration", "accountability", "accumulation", "acknowledgment", "adaptation",
    "adequacy", "adhesion", "administration", "admiration", "adversary", "advocate", "affiliation",
    "aftermath", "allegation", "allocation", "ambiguity", "analogy", "apparatus", "apprehension",
    "arbitrary", "array", "aspiration", "assertion", "audit", "autonomy", "benchmark",
    // B2 adjectives
    "abrupt", "absurd", "abundant", "acute", "adverse", "aesthetic", "affirmative", "aggregate",
    "agile", "alarming", "alleged", "ambitious", "ambiguous", "ample", "analogous", "anonymous",
    "applicable", "arbitrary", "authentic", "autonomous", "binding", "blunt", "bureaucratic",
  ],
  C1: [
    "abridge", "absolve", "accentuate", "accredit", "adjudicate", "admonish", "amalgamate",
    "ameliorate", "annex", "annihilate", "appease", "apportion", "arbitrate", "assimilate",
    "attenuate", "bequeath", "bewilder", "bolster", "buttress", "circumscribe", "circumvent",
    "coalesce", "coerce", "commiserate", "compel", "compensate", "concede", "conciliate",
    "condone", "confiscate", "congregate", "conjecture", "connote", "consecrate", "consolidate",
    "construe", "consummate", "contemplate", "contravene", "converge", "convoke", "corroborate",
    // C1 nouns
    "aberration", "abstinence", "accolade", "acumen", "adjunct", "admonition", "adversity",
    "affidavit", "affluence", "allegiance", "allusion", "altruism", "amalgamation", "amnesty",
    "anarchy", "anomaly", "antithesis", "apathy", "apprehension", "arbiter", "archetype",
    "ascendancy", "austerity", "axiom", "benefactor", "benevolence", "brevity", "bureaucracy",
  ],
  C2: [
    "abnegate", "abrogate", "abstemious", "abstruse", "accede", "acrimonious", "adjure",
    "adulterate", "aggrandize", "alacrity", "ambivalence", "anachronism", "anathema", "antediluvian",
    "apotheosis", "approbation", "arrogate", "ascetic", "aspersion", "assiduous", "atavistic",
    "attenuate", "avarice", "avuncular", "bellicose", "blandishment", "bloviate", "bombastic",
    "brusque", "bucolic", "cabal", "cacophony", "calumny", "capitulate", "capricious",
    "castigate", "caustic", "chicanery", "circumlocution", "clandestine", "cognoscente",
  ],
};

export const getKnownWordsForLevel = (level: CefrLevel): string[] => {
  const targetIndex = CEFR_ORDER.indexOf(level);
  const result: string[] = [];
  for (let i = 0; i <= targetIndex; i++) {
    result.push(...WORDS_BY_LEVEL[CEFR_ORDER[i]]);
  }
  return result;
};

const WORD_TO_LEVEL = new Map<string, CefrLevel>();

for (const level of CEFR_ORDER) {
  for (const word of WORDS_BY_LEVEL[level]) {
    if (!WORD_TO_LEVEL.has(word)) {
      WORD_TO_LEVEL.set(word, level);
    }
  }
}

export const getWordLevel = (lemma: string): CefrLevel | null => {
  return WORD_TO_LEVEL.get(lemma.toLowerCase()) ?? null;
};
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/frequency-list.ts
git commit -m "feat: add CEFR-tagged frequency word list for vocabulary baseline"
```

---

### Task 6: AI Service Layer

**Files:**
- Create: `lib/ai.ts`
- Create: `app/api/chat/route.ts`
- Create: `app/api/review/route.ts`
- Create: `app/api/extract/route.ts`

**Interfaces:**
- Consumes: environment variables `OG_API_KEY`, `OG_API_BASE_URL`, `OG_DEFAULT_MODEL`, `OG_QUALITY_MODEL`
- Produces:
  - `defaultModel` — Vercel AI SDK model instance for fast tasks
  - `qualityModel` — Vercel AI SDK model instance for review/assessment tasks
  - `POST /api/chat` — streaming chat completion endpoint (accepts `{messages, system}`, returns AI SDK stream)
  - `POST /api/review` — non-streaming JSON endpoint (accepts `{prompt, system}`, returns `{content: string}`)
  - `POST /api/extract` — URL extraction endpoint (accepts `{url}`, returns `{title, content, error?}`)

- [ ] **Step 1: Create AI provider configuration**

Create `lib/ai.ts`:

```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const og = createOpenAICompatible({
  name: "0g",
  baseURL: process.env.OG_API_BASE_URL ?? "https://router-api.0g.ai/v1",
  apiKey: process.env.OG_API_KEY ?? "",
});

export const defaultModel = og(
  process.env.OG_DEFAULT_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash"
);

export const qualityModel = og(
  process.env.OG_QUALITY_MODEL ?? "anthropic/claude-sonnet-5"
);
```

- [ ] **Step 2: Create chat streaming endpoint**

Create `app/api/chat/route.ts`:

```typescript
import { streamText } from "ai";
import { defaultModel, qualityModel } from "@/lib/ai";

export const maxDuration = 60;

export const POST = async (req: Request): Promise<Response> => {
  const { messages, system, useQualityModel } = await req.json();

  const model = useQualityModel ? qualityModel : defaultModel;

  const result = streamText({
    model,
    system,
    messages,
  });

  return result.toDataStreamResponse();
};
```

- [ ] **Step 3: Create review (non-streaming) endpoint**

Create `app/api/review/route.ts`:

```typescript
import { generateText } from "ai";
import { qualityModel } from "@/lib/ai";

export const maxDuration = 120;

export const POST = async (req: Request): Promise<Response> => {
  const { prompt, system } = await req.json();

  const result = await generateText({
    model: qualityModel,
    system,
    prompt,
  });

  return Response.json({ content: result.text });
};
```

- [ ] **Step 4: Create URL extraction endpoint**

First install the dependency:

```bash
npm install @mozilla/readability linkedom
npm install -D @types/linkedom
```

Create `app/api/extract/route.ts`:

```typescript
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const maxDuration = 15;

export const POST = async (req: Request): Promise<Response> => {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return Response.json(
      { title: "", content: "", error: "URL is required" },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return Response.json(
        { title: "", content: "", error: `Fetch failed: ${response.status}` },
        { status: 200 }
      );
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.length < 100) {
      return Response.json(
        {
          title: "",
          content: "",
          error:
            "Could not extract article content. The page may require login or be JavaScript-rendered. Try pasting the text directly.",
        },
        { status: 200 }
      );
    }

    let content = article.textContent.trim();
    const wordCount = content.split(/\s+/).length;
    let truncated = false;

    if (wordCount > 5000) {
      const words = content.split(/\s+/).slice(0, 5000);
      content = words.join(" ");
      truncated = true;
    }

    // Basic English detection: check if most characters are Latin
    const latinChars = (content.match(/[a-zA-Z]/g) || []).length;
    const totalChars = content.replace(/\s/g, "").length;
    const isEnglish = totalChars > 0 && latinChars / totalChars > 0.7;

    return Response.json({
      title: article.title || "Untitled",
      content,
      truncated,
      isEnglish,
      wordCount: Math.min(wordCount, 5000),
      error: isEnglish
        ? null
        : "Warning: This content may not be in English.",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Request timed out (10s). Try pasting the text directly."
        : "Failed to fetch URL. Try pasting the text directly.";
    return Response.json(
      { title: "", content: "", error: message },
      { status: 200 }
    );
  }
};
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors. If `linkedom` types are missing, add a declaration file `lib/linkedom.d.ts`:

```typescript
declare module "linkedom" {
  export function parseHTML(html: string): { document: Document };
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/ai.ts app/api/ lib/linkedom.d.ts
git commit -m "feat: add AI service layer and API route handlers"
```

---

### Task 7: Zustand Store

**Files:**
- Create: `stores/app-store.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `useAppStore` hook with state:
  - `isOnboarded: boolean`
  - `sidebarOpen: boolean`
  - `setOnboarded: (v: boolean) => void`
  - `setSidebarOpen: (v: boolean) => void`
  - `toggleSidebar: () => void`

- [ ] **Step 1: Create Zustand store**

Create `stores/app-store.ts`:

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  isOnboarded: boolean;
  sidebarOpen: boolean;
  setOnboarded: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isOnboarded: false,
      sidebarOpen: true,
      setOnboarded: (v) => set({ isOnboarded: v }),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    {
      name: "en-tutor-app",
    }
  )
);
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add stores/app-store.ts
git commit -m "feat: add Zustand app store with persist middleware"
```

---

### Task 8: App Shell Layout

**Files:**
- Create: `components/providers.tsx`
- Create: `components/sidebar-nav.tsx`
- Create: `components/app-shell.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useAppStore` from `stores/app-store.ts`, shadcn `Sidebar`, `Button`, `Tooltip` components
- Produces: rendered app shell with sidebar navigation, top bar, main content area. All pages render inside `<AppShell>`.

- [ ] **Step 1: Create providers wrapper**

Create `components/providers.tsx`:

```typescript
"use client";

import { type ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

export const Providers = ({ children }: { children: ReactNode }) => {
  return <SidebarProvider>{children}</SidebarProvider>;
};
```

- [ ] **Step 2: Create sidebar navigation**

Create `components/sidebar-nav.tsx`:

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { title: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { title: "Conversation", href: "/conversation", icon: "MessageSquare" },
  { title: "Reader", href: "/reader", icon: "BookOpen" },
  { title: "Writing", href: "/writing", icon: "PenLine" },
  { title: "Review Cards", href: "/srs", icon: "Brain" },
  { title: "Profile", href: "/profile", icon: "TrendingUp" },
  { title: "Assessment", href: "/assessment", icon: "ClipboardCheck" },
] as const;

const ICON_MAP: Record<string, string> = {
  LayoutDashboard: "Home",
  MessageSquare: "Chat",
  BookOpen: "Read",
  PenLine: "Write",
  Brain: "SRS",
  TrendingUp: "Stats",
  ClipboardCheck: "Test",
};

export const SidebarNav = () => {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          EnTutor
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Learn</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href}>
                        <span className="text-xs font-mono text-muted-foreground w-10">
                          {ICON_MAP[item.icon]}
                        </span>
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/settings"}>
              <Link href="/settings">
                <span className="text-xs font-mono text-muted-foreground w-10">
                  Cfg
                </span>
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
```

- [ ] **Step 3: Create app shell**

Create `components/app-shell.tsx`:

```typescript
"use client";

import { type ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export const AppShell = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <SidebarNav />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm text-muted-foreground">
            English Learning Tutor
          </span>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </SidebarInset>
    </>
  );
};
```

- [ ] **Step 4: Update root layout**

Replace the contents of `app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "EnTutor - English Learning",
  description: "AI-powered English learning for practical fluency",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;
```

- [ ] **Step 5: Update home page placeholder**

Replace the contents of `app/page.tsx`:

```typescript
const DashboardPage = () => {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome to EnTutor. Dashboard content will be implemented in Phase 3.
      </p>
    </div>
  );
};

export default DashboardPage;
```

- [ ] **Step 6: Verify dev server renders correctly**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: sidebar with navigation items, header bar with sidebar toggle, "Dashboard" heading in main content area.

- [ ] **Step 7: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add components/ app/layout.tsx app/page.tsx
git commit -m "feat: add app shell with sidebar navigation and layout"
```

---

### Task 9: Dexie React Hooks

**Files:**
- Create: `hooks/use-db.ts`

**Interfaces:**
- Consumes: `db` from `lib/db.ts`, `dbHelpers` from `lib/db-helpers.ts`, `useLiveQuery` from `dexie-react-hooks`
- Produces:
  - `useProfile(): LearningProfile | undefined`
  - `useDueCards(limit?: number): Card[]`
  - `useVocabCounts(): Record<MasteryLevel, number> | undefined`
  - `useTodayStats(): DailyStats | undefined`
  - `useStatsRange(startDate: string, endDate: string): DailyStats[]`
  - `useConversations(limit?: number): Conversation[]`
  - `useReadingSessions(limit?: number): ReadingSession[]`
  - `useWritingSessions(limit?: number): WritingSession[]`

- [ ] **Step 1: Install dexie-react-hooks**

```bash
npm install dexie-react-hooks
```

- [ ] **Step 2: Create hooks**

Create `hooks/use-db.ts`:

```typescript
"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import type {
  Card,
  Conversation,
  DailyStats,
  LearningProfile,
  MasteryLevel,
  ReadingSession,
  WritingSession,
} from "@/lib/types";

export const useProfile = (): LearningProfile | undefined => {
  return useLiveQuery(() => dbHelpers.getProfile());
};

export const useDueCards = (limit: number = 50): Card[] => {
  return useLiveQuery(() => dbHelpers.getDueCards(limit), [limit]) ?? [];
};

export const useVocabCounts = ():
  | Record<MasteryLevel, number>
  | undefined => {
  return useLiveQuery(() => dbHelpers.getVocabCounts());
};

export const useTodayStats = (): DailyStats | undefined => {
  return useLiveQuery(() => dbHelpers.getTodayStats());
};

export const useStatsRange = (
  startDate: string,
  endDate: string
): DailyStats[] => {
  return (
    useLiveQuery(
      () => dbHelpers.getStatsRange(startDate, endDate),
      [startDate, endDate]
    ) ?? []
  );
};

export const useConversations = (limit: number = 20): Conversation[] => {
  return (
    useLiveQuery(() =>
      db.conversations.orderBy("createdAt").reverse().limit(limit).toArray()
    ) ?? []
  );
};

export const useReadingSessions = (
  limit: number = 20
): ReadingSession[] => {
  return (
    useLiveQuery(() =>
      db.readingSessions.orderBy("createdAt").reverse().limit(limit).toArray()
    ) ?? []
  );
};

export const useWritingSessions = (
  limit: number = 20
): WritingSession[] => {
  return (
    useLiveQuery(() =>
      db.writingSessions.orderBy("createdAt").reverse().limit(limit).toArray()
    ) ?? []
  );
};
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-db.ts
git commit -m "feat: add Dexie React hooks for live database queries"
```

---

### Task 10: Settings Page

**Files:**
- Create: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `useAppStore` from `stores/app-store.ts`, `useProfile` from `hooks/use-db.ts`, `dbHelpers` from `lib/db-helpers.ts`, shadcn `Card`, `Input`, `Label`, `Select`, `Button`, `Separator`
- Produces: rendered Settings page with API key configuration test, CEFR level display, daily goal settings

- [ ] **Step 1: Create settings page**

Create `app/settings/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useProfile } from "@/hooks/use-db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const SettingsPage = () => {
  const profile = useProfile();
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

  const handleTestApi = async () => {
    setTestStatus("testing");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Say hello in one word." }],
          system: "Respond in one word only.",
        }),
      });
      if (res.ok) {
        setTestStatus("success");
        setTestMessage("API connection successful");
      } else {
        setTestStatus("error");
        setTestMessage(`API error: ${res.status}`);
      }
    } catch (e) {
      setTestStatus("error");
      setTestMessage(
        `Connection failed: ${e instanceof Error ? e.message : "Unknown error"}`
      );
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>AI Configuration</CardTitle>
          <CardDescription>
            API key is configured via environment variable (.env.local).
            Use the test button to verify the connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button onClick={handleTestApi} disabled={testStatus === "testing"}>
              {testStatus === "testing" ? "Testing..." : "Test API Connection"}
            </Button>
            {testMessage && (
              <span
                className={
                  testStatus === "success"
                    ? "text-sm text-green-600"
                    : "text-sm text-red-600"
                }
              >
                {testMessage}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Learning Profile</CardTitle>
          <CardDescription>
            Your current learning configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Initial CEFR Level</Label>
            <Input
              value={profile?.initialCefrLevel || "Not set"}
              disabled
              className="max-w-xs"
            />
          </div>
          <div className="grid gap-2">
            <Label>Known Words (Base)</Label>
            <Input
              value={
                profile?.knownWordsBase
                  ? `${profile.knownWordsBase.length} words`
                  : "Not set"
              }
              disabled
              className="max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            EnTutor v1.0 — AI-powered English learning for practical fluency.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
```

- [ ] **Step 2: Verify dev server renders**

```bash
npm run dev
```

Navigate to `http://localhost:3000/settings`. Expected: Settings page with API test button and profile info cards.

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/settings/
git commit -m "feat: add settings page with API connection test"
```

---

### Task 11: Onboarding Flow

**Files:**
- Create: `app/onboarding/page.tsx`
- Modify: `app/layout.tsx` (add onboarding redirect logic)

**Interfaces:**
- Consumes: `useAppStore` from `stores/app-store.ts`, `dbHelpers.initProfile` from `lib/db-helpers.ts`, `getKnownWordsForLevel` and `CefrLevel` from `lib/frequency-list.ts`, shadcn `Card`, `Button`, `Select`
- Produces: rendered onboarding page that collects CEFR level, initializes the `learningProfile` in IndexedDB, sets `isOnboarded = true` in Zustand, and redirects to Dashboard

- [ ] **Step 1: Create onboarding page**

Create `app/onboarding/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/stores/app-store";
import { dbHelpers } from "@/lib/db-helpers";
import {
  getKnownWordsForLevel,
  type CefrLevel,
} from "@/lib/frequency-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LEVELS: Array<{ value: CefrLevel; label: string; description: string }> =
  [
    {
      value: "A2",
      label: "A2 - Elementary",
      description:
        "I can understand simple sentences and common expressions. I can communicate in simple, routine tasks.",
    },
    {
      value: "B1",
      label: "B1 - Intermediate",
      description:
        "I can deal with most daily situations. I can describe experiences, events, and ambitions.",
    },
    {
      value: "B2",
      label: "B2 - Upper Intermediate",
      description:
        "I can interact fluently with native speakers. I can produce clear, detailed text on a wide range of subjects.",
    },
    {
      value: "C1",
      label: "C1 - Advanced",
      description:
        "I can express ideas fluently and spontaneously. I can use language flexibly for social, academic, and professional purposes.",
    },
  ];

const OnboardingPage = () => {
  const router = useRouter();
  const setOnboarded = useAppStore((s) => s.setOnboarded);
  const [selectedLevel, setSelectedLevel] = useState<CefrLevel | null>(null);
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!selectedLevel) return;
    setLoading(true);

    const knownWords = getKnownWordsForLevel(selectedLevel);
    await dbHelpers.initProfile(selectedLevel, knownWords);
    setOnboarded(true);
    router.push("/");
  };

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Welcome to EnTutor</h1>
        <p className="text-muted-foreground">
          Let&apos;s set up your learning profile. Select your current English
          level so we can personalize your experience.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {LEVELS.map((level) => (
          <Card
            key={level.value}
            className={`cursor-pointer transition-colors ${
              selectedLevel === level.value
                ? "border-primary bg-primary/5"
                : "hover:border-muted-foreground/50"
            }`}
            onClick={() => setSelectedLevel(level.value)}
          >
            <CardHeader className="py-4">
              <CardTitle className="text-base">{level.label}</CardTitle>
              <CardDescription>{level.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {selectedLevel && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We&apos;ll mark{" "}
            <strong>
              {getKnownWordsForLevel(selectedLevel).length} common words
            </strong>{" "}
            as already known. You can always adjust this later.
          </p>
          <Button
            onClick={handleComplete}
            disabled={loading}
            size="lg"
          >
            {loading ? "Setting up..." : "Start Learning"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default OnboardingPage;
```

- [ ] **Step 2: Add onboarding guard to layout**

Update `app/layout.tsx` — wrap children in a client component that checks onboarding status:

Create `components/onboarding-guard.tsx`:

```typescript
"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppStore } from "@/stores/app-store";

export const OnboardingGuard = ({ children }: { children: ReactNode }) => {
  const isOnboarded = useAppStore((s) => s.isOnboarded);
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !isOnboarded && pathname !== "/onboarding") {
      router.replace("/onboarding");
    }
  }, [hydrated, isOnboarded, pathname, router]);

  if (!hydrated) return null;

  if (!isOnboarded && pathname !== "/onboarding") return null;

  return <>{children}</>;
};
```

Update `app/layout.tsx` to wrap `<AppShell>` with `<OnboardingGuard>`:

```typescript
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { OnboardingGuard } from "@/components/onboarding-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "EnTutor - English Learning",
  description: "AI-powered English learning for practical fluency",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>
          <OnboardingGuard>
            <AppShell>{children}</AppShell>
          </OnboardingGuard>
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;
```

- [ ] **Step 3: Verify full flow**

```bash
npm run dev
```

1. Open `http://localhost:3000` -> should redirect to `/onboarding`
2. Select a CEFR level -> click "Start Learning"
3. Should redirect to Dashboard
4. Refresh page -> should stay on Dashboard (persisted via Zustand)
5. Navigate to Settings -> should show the selected CEFR level and word count

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/onboarding/ components/onboarding-guard.tsx app/layout.tsx
git commit -m "feat: add onboarding flow with CEFR level selection and vocabulary baseline"
```

---

## Phase 1 Completion Checklist

After all 11 tasks are complete, verify:

- [ ] Dev server starts and renders at `http://localhost:3000`
- [ ] New user is redirected to `/onboarding`
- [ ] Onboarding selects CEFR level and initializes profile
- [ ] After onboarding, Dashboard placeholder renders with sidebar navigation
- [ ] All sidebar links navigate correctly (pages show placeholders)
- [ ] Settings page loads and API test button works
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All code committed to git

---

## What Phase 2 Builds On

Phase 2 (Core Modules) will consume:
- `db` and `dbHelpers` for all data operations
- `useProfile`, `useDueCards`, `useVocabCounts`, `useTodayStats` hooks for live data
- `/api/chat` for streaming conversations and word lookups
- `/api/review` for session review and writing review
- `/api/extract` for URL article extraction
- `computeNextReview` and `getNextIntervals` for SRS card review
- `isWordKnown` and `getKnownWordsForLevel` for vocabulary coverage
- `AppShell` and sidebar navigation for page layout
- `useAppStore` for UI state
