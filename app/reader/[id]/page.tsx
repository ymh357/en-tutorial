"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Volume2, Loader2, Plus, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { UNKNOWN_DIFFICULTY, type Card as SrsCard, type ReadingLookup } from "@/lib/types";
import { speak } from "@/lib/tts";

// Splits article text into paragraphs, and each paragraph into tokens
// (words and separators) so every word can be rendered as a clickable span.
const WORD_RE = /[A-Za-z']+/g;

const splitIntoSentences = (text: string): string[] => {
  const matches = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [text];
};

const tokenizeParagraph = (
  paragraph: string
): Array<{ text: string; isWord: boolean }> => {
  const tokens: Array<{ text: string; isWord: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(paragraph)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: paragraph.slice(lastIndex, match.index), isWord: false });
    }
    tokens.push({ text: match[0], isWord: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < paragraph.length) {
    tokens.push({ text: paragraph.slice(lastIndex), isWord: false });
  }
  return tokens;
};

const lemmatize = (word: string): string => word.trim().toLowerCase();

const findSentenceForWord = (sentences: string[], word: string, occurrenceIndex: number): string => {
  // Best-effort: find the sentence that contains this word occurrence.
  let seen = 0;
  const lowerWord = word.toLowerCase();
  for (const sentence of sentences) {
    const regex = new RegExp(`\\b${lowerWord}\\b`, "gi");
    const count = (sentence.match(regex) ?? []).length;
    if (seen + count > occurrenceIndex) return sentence;
    seen += count;
  }
  return sentences[sentences.length - 1] ?? word;
};

interface WordPopupState {
  word: string;
  lemma: string;
  sentence: string;
  position: number;
  definition: string | null;
  isLoading: boolean;
  error: string | null;
}

interface SentencePanelState {
  sentence: string;
  analysis: string | null;
  isLoading: boolean;
  error: string | null;
}

const ReaderSessionPage = ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const { id } = use(params);
  const router = useRouter();

  const session = useLiveQuery(() => db.readingSessions.get(id), [id]);
  const profile = useLiveQuery(() => dbHelpers.getProfile());
  const srsLemmas = useLiveQuery(() => db.cards.toArray(), []);

  const [wordPopup, setWordPopup] = useState<WordPopupState | null>(null);
  const [sentencePanel, setSentencePanel] = useState<SentencePanelState | null>(null);
  const [addedLemmas, setAddedLemmas] = useState<Set<string>>(new Set());
  const [isAddingToSrs, setIsAddingToSrs] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishSummary, setFinishSummary] = useState<{
    lookups: number;
    duration: number;
    coverage: number;
  } | null>(null);

  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();
  }, [id]);

  const sentences = useMemo(
    () => (session ? splitIntoSentences(session.content) : []),
    [session]
  );

  const paragraphs = useMemo(
    () => (session ? session.content.split(/\n+/).filter((p) => p.trim()) : []),
    [session]
  );

  const srsLemmaSet = useMemo(() => {
    const set = new Set<string>();
    for (const card of srsLemmas ?? []) set.add(card.lemma);
    return set;
  }, [srsLemmas]);

  const knownWordsSet = useMemo(() => {
    const set = new Set<string>();
    for (const word of profile?.knownWordsBase ?? []) set.add(word.toLowerCase());
    return set;
  }, [profile]);

  const masteredLemmaSet = useMemo(() => {
    const set = new Set<string>();
    for (const card of srsLemmas ?? []) {
      if (card.masteryLevel === "mastered") set.add(card.lemma);
    }
    return set;
  }, [srsLemmas]);

  const vocabCoverage = useMemo(() => {
    if (!session) return 0;
    const words = session.content.match(WORD_RE) ?? [];
    if (words.length === 0) return 0;
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    let known = 0;
    for (const word of uniqueWords) {
      if (knownWordsSet.has(word) || masteredLemmaSet.has(word)) known += 1;
    }
    return Math.round((known / uniqueWords.size) * 100);
  }, [session, knownWordsSet, masteredLemmaSet]);

  // Tracks the running occurrence count per lemma while rendering,
  // so word popups can locate the right sentence.
  const occurrenceCounterRef = useRef<Map<string, number>>(new Map());

  const handleWordClick = async (word: string, position: number) => {
    const lemma = lemmatize(word);
    const occurrenceIndex = occurrenceCounterRef.current.get(lemma) ?? 0;
    const sentence = findSentenceForWord(sentences, word, occurrenceIndex);

    setSentencePanel(null);
    setWordPopup({
      word,
      lemma,
      sentence,
      position,
      definition: null,
      isLoading: true,
      error: null,
    });

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Define the word "${word}" as used in this context: "${sentence}". Give a brief, contextual definition (not a dictionary definition). If the word has a specific meaning in this context that differs from its most common meaning, explain that. Response format: just the definition, 1-2 sentences max.`,
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: { content?: string; error?: string } = await res.json();
      if (data.error || !data.content) throw new Error(data.error || "No definition returned");

      setWordPopup((prev) =>
        prev && prev.word === word && prev.position === position
          ? { ...prev, definition: data.content!.trim(), isLoading: false }
          : prev
      );

      if (session) {
        const lookup: ReadingLookup = {
          word,
          lemma,
          definition: data.content.trim(),
          position,
        };
        const existingLookups = session.lookups.filter(
          (l) => !(l.word === word && l.position === position)
        );
        await db.readingSessions.update(session.id, {
          lookups: [...existingLookups, lookup],
        });
      }
    } catch (err) {
      setWordPopup((prev) =>
        prev && prev.word === word && prev.position === position
          ? {
              ...prev,
              isLoading: false,
              error: err instanceof Error ? err.message : "Failed to fetch definition",
            }
          : prev
      );
    }
  };

  const handleSentenceClick = async (sentence: string) => {
    setWordPopup(null);
    setSentencePanel({ sentence, analysis: null, isLoading: true, error: null });

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Analyze the grammar structure of this English sentence: "${sentence}". Break down the clauses, identify the main structure, and explain anything non-obvious. Then provide a natural Chinese translation. Keep it concise and well-organized with clear sections.`,
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: { content?: string; error?: string } = await res.json();
      if (data.error || !data.content) throw new Error(data.error || "No analysis returned");

      setSentencePanel((prev) =>
        prev && prev.sentence === sentence
          ? { ...prev, analysis: data.content!.trim(), isLoading: false }
          : prev
      );

      if (session) {
        const existing = session.sentenceAnalyses.filter((a) => a.sentence !== sentence);
        await db.readingSessions.update(session.id, {
          sentenceAnalyses: [...existing, { sentence, analysis: data.content.trim() }],
        });
      }
    } catch (err) {
      setSentencePanel((prev) =>
        prev && prev.sentence === sentence
          ? {
              ...prev,
              isLoading: false,
              error: err instanceof Error ? err.message : "Failed to analyze sentence",
            }
          : prev
      );
    }
  };

  const handleAddToSrs = async () => {
    if (!wordPopup || !wordPopup.definition || !session) return;
    setIsAddingToSrs(true);
    try {
      const existing = await dbHelpers.getCardByLemma(wordPopup.lemma);
      if (!existing) {
        const newCard: SrsCard = {
          id: crypto.randomUUID(),
          type: "vocabulary",
          lemma: wordPopup.lemma,
          front: wordPopup.word,
          back: wordPopup.definition,
          context: wordPopup.sentence,
          source: "reading",
          sourceId: session.id,
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          nextReview: new Date(),
          masteryLevel: "new",
          createdAt: new Date(),
          lastReviewedAt: null,
        };
        await db.cards.add(newCard);
        await dbHelpers.incrementTodayStat("wordsLearned");
      }
      setAddedLemmas((prev) => new Set(prev).add(wordPopup.lemma));
    } finally {
      setIsAddingToSrs(false);
    }
  };

  const handleFinishReading = async () => {
    if (!session) return;
    setIsFinishing(true);
    try {
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      await db.readingSessions.update(session.id, {
        duration: session.duration + durationSeconds,
        vocabCoverage,
      });
      await dbHelpers.incrementTodayStat("readingCount");
      await dbHelpers.incrementTodayStat("timeSpent", Math.round(durationSeconds / 60));
      await dbHelpers.updateStreak();

      setFinishSummary({
        lookups: session.lookups.length,
        duration: durationSeconds,
        coverage: vocabCoverage,
      });
    } finally {
      setIsFinishing(false);
    }
  };

  if (session === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="max-w-2xl space-y-4">
        <p className="text-muted-foreground">Reading session not found.</p>
        <Button variant="outline" onClick={() => router.push("/reader")}>
          <ArrowLeft className="h-4 w-4" />
          Back to Reader
        </Button>
      </div>
    );
  }

  if (finishSummary) {
    return (
      <div className="max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Reading Complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{finishSummary.lookups}</div>
                <div className="text-xs text-muted-foreground">Words Looked Up</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {Math.round(finishSummary.duration / 60)}m
                </div>
                <div className="text-xs text-muted-foreground">Time Spent</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{finishSummary.coverage}%</div>
                <div className="text-xs text-muted-foreground">Vocab Coverage</div>
              </div>
            </div>
            <Button className="w-full" onClick={() => router.push("/reader")}>
              Back to Reader
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Reset occurrence counters for this render pass.
  occurrenceCounterRef.current = new Map();
  let globalPosition = 0;

  const hasLookupPanel = Boolean(wordPopup || sentencePanel);

  const lookupPanelContent = (
    <>
      {wordPopup && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                Word: &quot;{wordPopup.word}&quot;
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => void speak(wordPopup.word)}
                >
                  <Volume2 className="h-4 w-4" />
                </Button>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setWordPopup(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {wordPopup.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Looking up definition...
              </div>
            )}
            {wordPopup.error && (
              <p className="text-sm text-destructive">{wordPopup.error}</p>
            )}
            {wordPopup.definition && (
              <p className="text-sm">
                <span className="text-muted-foreground">In this context: </span>
                {wordPopup.definition}
              </p>
            )}
            {wordPopup.definition && (
              <Button
                size="sm"
                onClick={() => void handleAddToSrs()}
                disabled={isAddingToSrs || addedLemmas.has(wordPopup.lemma)}
              >
                {addedLemmas.has(wordPopup.lemma) ? (
                  <>
                    <Check className="h-4 w-4" />
                    Added
                  </>
                ) : isAddingToSrs ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Add to SRS
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {sentencePanel && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Sentence Analysis</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSentencePanel(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm italic text-muted-foreground">
              &quot;{sentencePanel.sentence}&quot;
            </p>
            <Separator />
            {sentencePanel.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing sentence...
              </div>
            )}
            {sentencePanel.error && (
              <p className="text-sm text-destructive">{sentencePanel.error}</p>
            )}
            {sentencePanel.analysis && (
              <p className="text-sm whitespace-pre-wrap">{sentencePanel.analysis}</p>
            )}
          </CardContent>
        </Card>
      )}

      {!hasLookupPanel && (
        <p className="hidden lg:block text-sm text-muted-foreground">
          Click a word for its definition or a sentence for a grammar breakdown. Results appear
          here.
        </p>
      )}
    </>
  );

  return (
    <div className="flex flex-col lg:flex-row lg:items-start gap-4 pb-24 lg:pb-8 px-4 md:px-8">
      <div className="flex-1 min-w-0 max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => router.push("/reader")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-bold truncate">{session.title}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {session.difficulty && session.difficulty !== UNKNOWN_DIFFICULTY && (
              <Badge>{session.difficulty}</Badge>
            )}
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          Vocab Coverage: <span className="font-semibold text-foreground">{vocabCoverage}%</span>{" "}
          known
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4 leading-relaxed text-base px-4 md:px-6">
            {paragraphs.map((paragraph, pIndex) => {
              const tokens = tokenizeParagraph(paragraph);
              return (
                <p key={pIndex}>
                  {tokens.map((token, tIndex) => {
                    if (!token.isWord) {
                      return <span key={tIndex}>{token.text}</span>;
                    }
                    const lemma = lemmatize(token.text);
                    const count = occurrenceCounterRef.current.get(lemma) ?? 0;
                    occurrenceCounterRef.current.set(lemma, count + 1);
                    const position = globalPosition++;
                    const isInSrs = srsLemmaSet.has(lemma);
                    const isSelected = wordPopup?.position === position;

                    return (
                      <span
                        key={tIndex}
                        role="button"
                        tabIndex={0}
                        onClick={() => void handleWordClick(token.text, position)}
                        className={`cursor-pointer rounded px-0.5 py-0.5 inline-block min-h-[24px] hover:bg-primary/15 transition-colors ${
                          isSelected ? "bg-primary/25" : ""
                        } ${isInSrs ? "underline decoration-dotted decoration-primary/60 underline-offset-4" : ""}`}
                      >
                        {token.text}
                      </span>
                    );
                  })}
                </p>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Click a sentence below to get a grammar breakdown and translation:
          </p>
          <div className="flex flex-wrap gap-2">
            {sentences.map((sentence, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                className="text-xs h-auto min-h-[44px] py-2 whitespace-normal text-left"
                onClick={() => void handleSentenceClick(sentence)}
              >
                {sentence.length > 60 ? `${sentence.slice(0, 60)}...` : sentence}
              </Button>
            ))}
          </div>
        </div>

        <Button className="w-full" size="lg" onClick={() => void handleFinishReading()} disabled={isFinishing}>
          {isFinishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finishing...
            </>
          ) : (
            "Finish Reading"
          )}
        </Button>
      </div>

      {/* Desktop: sticky lookup sidebar that stays visible while scrolling the article. */}
      <div className="hidden lg:block lg:w-80 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:py-4 space-y-4">
        {lookupPanelContent}
      </div>

      {/* Mobile: fixed bottom sheet, only mounted while there's something to show. */}
      {hasLookupPanel && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto bg-background border-t shadow-lg p-4 space-y-4">
          {lookupPanelContent}
        </div>
      )}
    </div>
  );
};

export default ReaderSessionPage;
