# English Learning App - Design Spec

## Overview

A Next.js web application for practical English skill building, powered by 0G AI API. Focuses on real-world fluency through AI conversation, immersive reading, writing practice, and spaced repetition — with a comprehensive progress feedback system to sustain daily usage.

Target user: intermediate (B1-B2) English learner, supports multiple levels. Primary user is also the developer.

## Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| Next.js | 16.2.x | Full-stack framework (App Router) |
| React | 19.2.x | UI framework |
| TypeScript | 5.x strict | Type safety |
| Tailwind CSS | 4.3.x | Styling (v4 zero-config) |
| shadcn/ui | 4.13.x | Component library (includes Chat components) |
| Vercel AI SDK | 7.x (`ai`) | Streaming AI calls + frontend hooks |
| Dexie.js | 4.4.x | IndexedDB local persistence |
| Zustand | 5.x | Global state management |

### AI Backend

- **API Base**: `https://router-api.0g.ai/v1`
- **Format**: OpenAI-compatible, use `@ai-sdk/openai-compatible` provider
- **Default Model**: DeepSeek-V4-Flash (fast, for conversations and word lookups)
- **Quality Model**: Claude Sonnet 5 (writing review, session review, monthly assessment)
- **STT**: Whisper Large V3 (voice input transcription)
- **TTS**: Browser Web Speech API (no server-side TTS available)
- **API Key**: stored in server-side environment variable, all AI calls via Next.js Route Handlers

### Storage

- All data persisted in IndexedDB via Dexie.js (no external database)
- Tables: cards, conversations, reading_sessions, writing_sessions, learning_profile, daily_stats

### Speech Strategy

- **STT (Speech-to-Text)**: Whisper Large V3 via 0G API as primary; Web Speech API as browser fallback when Whisper is unavailable or for low-latency preview
- **TTS (Text-to-Speech)**: Browser Web Speech API (no server-side TTS available)

### Non-Goals (v1)

- No user auth / login system
- No social features / leaderboard
- No mobile-first optimization (desktop priority)
- No offline mode
- No audio/video content import

---

## Module 1: Dashboard

The first thing the user sees. Must answer: "What should I do right now?"

### Layout

```
+-------------------------------------------------------+
| [Logo] EnTutor                    [Settings]           |
+-------------------------------------------------------+
| Today's Plan          |  Stats Overview                |
| --------------------- |  ----------------------------- |
| [ ] Review 15 cards   |  Current Streak: 12 days       |
| [ ] 1 conversation    |  Longest Streak: 23 days       |
| [ ] Read 1 article    |  Words Mastered: 347           |
| [Start Today's Plan]  |  Level: B1 upper [=====>---]  |
+-------------------------------------------------------+
| Learning Heatmap (GitHub-style, 365 days)              |
| [jan] [feb] [mar] ... [jul]                            |
+-------------------------------------------------------+
| Weekly Summary         | Quick Launch                  |
| vs last week:          | [Chat] [Read] [Write] [SRS]   |
| Words +12, Errors -3  |                               |
+-------------------------------------------------------+
```

### Features

1. **Today's Plan**: auto-generated based on:
   - Overdue SRS cards (highest priority)
   - Days since last conversation/reading/writing practice
   - Suggested activity based on weak areas from Learning Profile
2. **Stats Overview**: streak counter (non-punitive: tracks "current" and "longest", no reset-to-zero), total mastered words, current level band with progress bar
3. **Learning Heatmap**: calendar view with color intensity = daily learning volume. Click any day to see detail.
4. **Weekly Summary**: auto-generated comparison vs last week (vocabulary growth, error rate change, practice volume)
5. **Quick Launch**: one-click access to any module

---

## Module 2: AI Conversation

### Entry Points (low friction)

1. **Quick Start**: one button -> AI picks a random scenario matched to user level
2. **AI Recommended**: based on weak areas ("You haven't practiced ordering food in a while")
3. **Scenario Library**: 20+ real-world scenarios with difficulty tags
   - Daily: ordering food, asking directions, shopping, small talk
   - Professional: job interview, business meeting, presentation, negotiation
   - Social: making friends, debate, storytelling, giving advice
   - Specific: doctor visit, apartment rental, airport, tech support
4. **Free Chat**: no scenario, just conversation on any topic
5. **Custom Scenario**: user describes a situation in Chinese, AI sets up the scene

### Conversation Interface

```
+-----------------------------------------------+
| Scenario: Job Interview (B2)                   |
| Role: You are interviewing for a PM position   |
| at a tech startup. The interviewer is Sarah.    |
+-----------------------------------------------+
| [Sarah]: Tell me about yourself and why you're |
|          interested in this position.           |
|                                                 |
| [You]: I've been working in product management  |
|        for three years...                       |
|                                                 |
| [Sarah]: That's interesting. Can you walk me    |
|          through a challenging project?          |
+-----------------------------------------------+
| [Type your response...        ] [🎤] [Send]    |
| [End & Review]                                  |
+-----------------------------------------------+
```

- Text input or voice input (Whisper STT primary, Web Speech API fallback)
- AI responses streamed, auto TTS playback (toggleable)
- AI stays in character throughout the conversation
- Minimum 5 exchanges before "End & Review" becomes active

### Session Review (post-conversation)

AI generates a structured review using the quality model:

1. **Score Card** (radar chart):
   - Fluency (1-10)
   - Accuracy (1-10)
   - Vocabulary Richness (1-10)
   - Sentence Complexity (1-10)
   - Historical trend line for each dimension

2. **Error Corrections**:
   - Original: "I have working here for 3 years"
   - Corrected: "I have been working here for 3 years"
   - Explanation: Present perfect continuous for ongoing duration
   - [Add to SRS]

3. **Expression Improvements**:
   - You said: "I think this is a good idea"
   - More natural: "I'd say this is a solid approach"
   - Context: More professional register for interview setting
   - [Add to SRS]

4. **Positive Highlights** (green markers):
   - "Good use of conditional: 'If I were to lead this project...'"
   - "Natural transition: 'Speaking of which...'"
   - Reinforces correct habits

5. **New Vocabulary**:
   - Words/phrases used by AI that may be new to user
   - Each with definition in context + example
   - [Add to SRS]

---

## Module 3: Immersive Reader

### Content Sources (low friction)

1. **AI-Generated Articles**: by difficulty (A2/B1/B2/C1) and topic (tech, business, culture, science, daily life). AI generates a ~300-500 word article on demand.
2. **Paste Text**: paste any English text directly
3. **URL Import**: enter a URL, server-side fetches and extracts article body (strip ads/nav)
4. **Reading History**: previously read articles

### Reading Interface

```
+----------------------------------------------------+
| The Future of Remote Work          [B2] [Tech]      |
| Vocab Coverage: 87% known                           |
+----------------------------------------------------+
|                                                      |
| The pandemic fundamentally altered how we think      |
| about [productivity] in the workplace. Companies     |
| that once [resisted] remote arrangements now find    |
| themselves [embracing] a hybrid model that offers    |
| greater flexibility to employees while maintaining   |
| [operational] efficiency.                            |
|                                                      |
| [Words in brackets are SRS-tracked / being learned]  |
+----------------------------------------------------+
| Word Panel (on click):                               |
| "resisted" -> in this context: opposed, pushed back  |
| against. Not the physical meaning.                   |
| Example: "The board resisted the merger proposal."   |
| [Add to SRS]                                         |
+----------------------------------------------------+
| [Select sentence for grammar analysis]               |
+----------------------------------------------------+
```

### Features

1. **Click-to-lookup**: click any word -> AI gives contextual definition (not dictionary definition). Shows pronunciation via TTS.
2. **Sentence Analysis**: select a sentence -> AI breaks down grammar structure, explains clauses, translates
3. **Vocabulary Coverage**: percentage of words the user already knows. On first launch, user selects current CEFR level; all words at or below that level in a built-in frequency list (top 5000 English words tagged by CEFR) are auto-marked as "known". Subsequent coverage is cross-referenced with this base + SRS mastered list. Visible progress: "You know 87% of words in this article"
4. **SRS Integration**: words being learned in SRS are highlighted in the text with a subtle marker. Encountering them in context reinforces memory.
5. **Post-read Summary**: after finishing, show new words encountered, time spent, coverage improvement

---

## Module 4: Writing Practice

### Task Types

1. **Guided Tasks** (with scaffolding):
   - Business Email: template structure (greeting -> context -> request -> closing)
   - Essay: thesis -> supporting points -> conclusion outline
   - Social Media Post: hook -> content -> CTA
   - Report Summary: situation -> findings -> recommendation
   - Each task has a brief, a word count target, and key phrases to try using
2. **Quick Tasks** (warm-up, low barrier):
   - Translate a Chinese sentence to English
   - Complete a sentence
   - Rewrite a sentence more formally/casually
   - Describe an image in 3 sentences
3. **Free Writing**: open editor, no constraints

### Writing & Review Interface

```
+----------------------------------------------------+
| Task: Write a follow-up email after a meeting       |
| Target: 100-150 words                               |
| Key phrases: follow up on, as discussed, action item|
+----------------------------------------------------+
| Editor:                                              |
| Dear Sarah,                                          |
|                                                      |
| Thank you for your time today. I wanted to follow    |
| up on the points we discussed in our meeting.        |
| As we agree ...                                      |
|                                                      |
+----------------------------------------------------+
| [Submit for Review]                                  |
+----------------------------------------------------+
```

### AI Review Output

Review is triggered on explicit submit (not real-time). This avoids excessive API calls and prevents interrupting the writing flow.

1. **Inline Annotations**:
   - Red: grammar errors with correction + explanation
   - Yellow: word choice suggestions with alternatives
   - Blue: style/register improvements
   - Green: excellent expressions (positive reinforcement)

2. **Diff View**: side-by-side original vs AI-polished version

3. **Error Pattern Tracking**:
   - "You've made tense errors in 4 of your last 6 writings"
   - "Your article usage has improved: 2 errors this week vs 7 last week"
   - Tracked error categories: tense, articles, prepositions, word order, subject-verb agreement, punctuation, word choice

4. **Score**: overall writing quality score (1-10) with trend chart

5. **SRS Integration**: error patterns and corrected expressions -> auto-generate SRS cards

---

## Module 5: Spaced Repetition System (SRS)

### Algorithm

SM-2 with modifications:
- Difficulty ratings: Again (0) / Hard (1) / Good (2) / Easy (3)
- Initial intervals: 1 min -> 10 min -> 1 day -> 3 days -> ...
- Ease factor adjusts per card based on response history
- New cards limited to 20/day (configurable)

### Card Types

1. **Vocabulary Card**:
   - Front: English word/phrase
   - Back: contextual definition + original sentence where encountered + TTS pronunciation
   - Source tag: conversation / reading / writing / manual

2. **Error Correction Card**:
   - Front: incorrect expression (e.g., "I have go there yesterday")
   - Back: correct form + grammar rule + example
   - Source tag: conversation / writing

3. **Expression Card**:
   - Front: Chinese meaning or casual English
   - Back: natural/idiomatic English expression + usage context
   - Source tag: conversation review suggestions

### Review Modes

1. **Flashcard**: standard flip card with self-rating
2. **Spelling**: hear the word (TTS), type it
3. **Sentence Building**: given a word, construct a sentence (AI evaluates)

### Review Interface

```
+----------------------------------------------------+
| Daily Review: 15 cards remaining                    |
| [===========-------] 73% done                      |
+----------------------------------------------------+
|                                                      |
| "resisted"                                           |
| [Show Answer]                                        |
|                                                      |
+----------------------------------------------------+
| Context: "The board resisted the merger proposal."   |
| Meaning: opposed, pushed back against                |
| Source: Reading - "The Future of Remote Work"        |
| Mastery: Learning (Day 3)                            |
|                                                      |
| [Again] [Hard] [Good] [Easy]                         |
| 1 min    10min   3 days  7 days                      |
+----------------------------------------------------+
```

### Mastery Levels

Each card progresses through stages:
- **New** (just added)
- **Learning** (interval < 7 days)
- **Familiar** (interval 7-30 days)
- **Mastered** (interval > 30 days, 3+ consecutive "Good/Easy")

Dashboard shows distribution pie chart across these levels.

---

## Module 6: Learning Profile

A cross-module intelligence layer that tracks the user's overall English ability.

### Data Tracked

1. **Vocabulary Inventory**: all words encountered, with mastery level
2. **Error Patterns**: categorized grammar/usage errors with frequency and trend
3. **Conversation Scores**: historical fluency/accuracy/vocabulary/complexity scores
4. **Writing Scores**: historical quality scores + error category breakdown
5. **Reading Level**: average article difficulty successfully read
6. **CEFR Estimate**: derived from all above signals

### How It Feeds Back Into Modules

- **Conversation**: AI knows user's weak grammar areas, gently steers conversation to practice them
- **Reading**: article difficulty recommendation matches current level
- **Writing**: task suggestions target weak areas
- **SRS**: cards from weak areas get slightly shorter intervals (more practice)
- **Dashboard**: weekly summary highlights improvements and remaining weaknesses

---

## Module 7: Monthly Assessment

### Trigger

Auto-prompted once per month (user can also trigger manually).

### Test Structure

1. **Reading Comprehension** (2 passages, 5 questions each)
2. **Cloze Test** (fill in blanks in a passage)
3. **Writing Task** (respond to a prompt, ~150 words)
4. **Conversation** (5-minute AI conversation on an unfamiliar topic)

### Output

1. **Level Estimate**: band-based (e.g., "B1 upper", "B2 lower") rather than false decimal precision. Internal score (0-100) tracks granular progress, displayed as a progress bar within the current band.
2. **Comparison with Previous Month**: radar chart overlay
3. **Detailed Breakdown**: strengths and weaknesses by category
4. **Recommended Focus Areas**: prioritized list for next month
5. **Milestone Celebrations**: "You've moved from B1 to B2!" with visual celebration

---

## Module 8: Progress & Motivation System

### Immediate Feedback (per session)

- Conversation: radar chart score + positive highlights
- Reading: vocabulary coverage percentage
- Writing: inline green markers for good expressions
- SRS: "mastered X days" badge on cards

### Daily/Weekly Feedback

- **Daily Summary Card**: new words, errors fixed, time spent
- **Weekly Report**: comparison charts vs last week
- **Streak Counter**: current + longest, non-punitive (no reset to zero, records both)

### Long-term Feedback

- **Vocabulary Growth Curve**: cumulative chart over months
- **Error Evolution Chart**: how error types shift over time (tense errors dropping, preposition errors emerging = progress)
- **CEFR Trend Line**: monthly assessment scores plotted
- **Learning Heatmap**: 365-day calendar view

### Milestones

| Milestone | Trigger |
|---|---|
| First Steps | Complete first conversation |
| Bookworm | Read 10 articles |
| Wordsmith | Master 100 words |
| Persistent | 7-day streak |
| Dedicated | 30-day streak |
| Essayist | Write 5000 words total |
| Conversationalist | Complete 50 conversations |
| Level Up | CEFR level increase |
| Vocabulary Builder | Master 500 words |
| Grammar Hero | Reduce an error category by 50% |

Milestones show as a toast notification when earned, and are displayed in a trophy case on the Dashboard.

---

## Page Structure

```
/                        -> Dashboard
/conversation            -> Scenario selection + quick start
/conversation/[id]       -> Active conversation
/conversation/[id]/review -> Session review
/reader                  -> Content source selection
/reader/[id]             -> Active reading session
/writing                 -> Task selection
/writing/[id]            -> Active writing + review
/srs                     -> Daily review queue
/srs/browse              -> Browse all cards
/profile                 -> Learning profile + progress charts
/assessment              -> Monthly assessment
/settings                -> API key, difficulty level, daily goals, TTS voice
```

---

## Data Schema (Dexie.js / IndexedDB)

### cards
```
id: string (uuid)
type: 'vocabulary' | 'error' | 'expression'
lemma: string (normalized word root for dedup and cross-module lookup, e.g., "resist" for "resisted")
front: string
back: string
context: string (original sentence)
source: 'conversation' | 'reading' | 'writing' | 'manual'
sourceId: string (reference to source session)
easeFactor: number (SM-2, default 2.5)
interval: number (days)
repetitions: number
nextReview: Date
masteryLevel: 'new' | 'learning' | 'familiar' | 'mastered'
createdAt: Date
lastReviewedAt: Date
```

### conversations
```
id: string (uuid)
scenario: string
scenarioType: 'preset' | 'custom' | 'free' | 'recommended'
messages: Array<{role: 'user' | 'assistant', content: string, timestamp: Date}>
review: {
  scores: {fluency, accuracy, vocabulary, complexity: number}
  errors: Array<{original, corrected, explanation: string}>
  improvements: Array<{original, improved, context: string}>
  highlights: Array<{text, reason: string}>
  newVocabulary: Array<{word, definition, example: string}>
}
duration: number (seconds)
createdAt: Date
```

### reading_sessions
```
id: string (uuid)
title: string
content: string
source: 'ai_generated' | 'pasted' | 'url'
sourceUrl?: string
difficulty: string (CEFR level)
lookups: Array<{word, definition, position: number}>
sentenceAnalyses: Array<{sentence, analysis: string}>
vocabCoverage: number (percentage)
duration: number (seconds)
createdAt: Date
```

### writing_sessions
```
id: string (uuid)
taskType: 'email' | 'essay' | 'social' | 'report' | 'quick' | 'free'
taskPrompt: string
content: string
wordCount: number
review: {
  score: number
  annotations: Array<{type: 'error' | 'suggestion' | 'style' | 'positive', start, end: number, original, replacement, explanation: string}>
  polishedVersion: string
  errorPatterns: Array<{category, description: string}>
}
createdAt: Date
```

### learning_profile
```
id: 'singleton'
streakCurrent: number
streakLongest: number
lastActiveDate: Date
milestones: Array<{id: string, earnedAt: Date}>
initialCefrLevel: string (set during onboarding)
knownWordsBase: string[] (auto-populated from frequency list based on initial level)
```

Note: Aggregated stats (vocabularyCount, errorPatterns, conversationScores, writingScores, cefrEstimates, totalWordsWritten, totalConversations, totalArticlesRead) are computed on-demand by querying the cards, conversations, reading_sessions, writing_sessions, and daily_stats tables. This avoids concurrent write conflicts when multiple tabs are open.

### daily_stats
```
id: string (YYYY-MM-DD)
wordsLearned: number
errorsFixed: number
conversationCount: number
readingCount: number
writingCount: number
srsReviewed: number
timeSpent: number (seconds)
```

---

## AI Prompt Strategy

### Model Selection per Task

| Task | Model | Reason |
|---|---|---|
| Conversation (in-chat) | DeepSeek-V4-Flash | Fast streaming, good enough quality |
| Word lookup (reader) | DeepSeek-V4-Flash | Speed critical for UX |
| Sentence analysis | DeepSeek-V4-Flash | Moderate complexity |
| Session Review | Claude Sonnet 5 | Needs nuanced error analysis |
| Writing Review | Claude Sonnet 5 | Needs detailed annotation quality |
| Article Generation | DeepSeek-V4-Flash | Quick generation |
| Monthly Assessment | Claude Sonnet 5 | Accuracy-critical evaluation |
| CEFR Estimation | Claude Sonnet 5 | Needs calibrated judgment |

### System Prompt Patterns

All prompts receive the user's Learning Profile summary (weak areas, current level, recent errors) so AI can personalize responses.

Conversation system prompt includes:
- Scenario description and role
- User's CEFR level -> adjust vocabulary and speech complexity
- Instruction to naturally incorporate practice for user's weak areas
- Stay in character, don't break to correct errors mid-conversation

Review prompts include:
- Full conversation/writing transcript
- User's historical error patterns
- Instruction to highlight positive expressions (not just errors)
- Structured output format (JSON) for frontend rendering

---

## URL Article Extraction

Server-side Route Handler:
1. Receive URL from client
2. Fetch page with appropriate User-Agent (timeout: 10s)
3. Extract main article content (use `@mozilla/readability` or similar)
4. Strip HTML, return clean text + title
5. Pass to Reader module

Error handling:
- Fetch failure (403, timeout, JS-only pages): show clear error message, suggest pasting text instead
- Content too long (>5000 words): truncate with a "Read more" marker, user can load next section
- Non-English content detection: warn user if detected language is not English (basic heuristic: character range check)
- Paywall / login-required: detect minimal extracted content (<100 words) and suggest pasting manually
