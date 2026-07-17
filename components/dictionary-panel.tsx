"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookA, Check, Loader2, Plus, Search, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { db } from "@/lib/db";
import type { Card as SrsCard } from "@/lib/types";

interface DictPhonetic {
  text?: string;
  audio?: string;
}

interface DictDefinition {
  definition: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
}

interface DictMeaning {
  partOfSpeech: string;
  definitions: DictDefinition[];
  synonyms?: string[];
  antonyms?: string[];
}

interface DictEntry {
  word: string;
  phonetic?: string;
  phonetics?: DictPhonetic[];
  meanings: DictMeaning[];
}

const HISTORY_KEY = "en-tutor-dict-history";
const MAX_HISTORY = 20;

const loadHistory = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
};

const saveHistory = (history: string[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Ignore storage errors — history is best-effort.
  }
};

const pushHistory = (word: string): string[] => {
  const existing = loadHistory().filter(
    (w) => w.toLowerCase() !== word.toLowerCase()
  );
  const next = [word, ...existing].slice(0, MAX_HISTORY);
  saveHistory(next);
  return next;
};

const findAudioUrl = (entries: DictEntry[]): string | null => {
  for (const entry of entries) {
    const withAudio = entry.phonetics?.find((p) => p.audio);
    if (withAudio?.audio) return withAudio.audio;
  }
  return null;
};

const findPhoneticText = (entries: DictEntry[]): string | null => {
  for (const entry of entries) {
    if (entry.phonetic) return entry.phonetic;
    const withText = entry.phonetics?.find((p) => p.text);
    if (withText?.text) return withText.text;
  }
  return null;
};

export const DictionaryPanel = () => {
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [entries, setEntries] = useState<DictEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Sheet mounts content on open; wait a tick for the input to exist.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isModifierPressed = e.metaKey || e.ctrlKey;
      if (isModifierPressed && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const lookupWord = async (rawWord: string): Promise<void> => {
    const word = rawWord.trim();
    if (!word || isLoading) return;

    setIsLoading(true);
    setError(null);
    setEntries(null);
    setAddedKeys(new Set());

    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
      );

      if (res.status === 404) {
        setError(`No definition found for "${word}".`);
        return;
      }
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }

      const data = (await res.json()) as DictEntry[];
      if (!Array.isArray(data) || data.length === 0) {
        setError(`No definition found for "${word}".`);
        return;
      }

      setEntries(data);
      setQuery(data[0].word);
      setHistory(pushHistory(data[0].word));
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void lookupWord(query);
  };

  const handlePlayAudio = (audioUrl: string): void => {
    const audio = new Audio(audioUrl);
    void audio.play();
  };

  const handleAddToSrs = async (
    word: string,
    definition: DictDefinition
  ): Promise<void> => {
    const key = `${word}:${definition.definition}`;
    if (addedKeys.has(key) || addingKey !== null) return;

    setAddingKey(key);
    try {
      const lemma = word.toLowerCase().trim();
      const existing = await db.cards.where("lemma").equals(lemma).first();
      if (!existing) {
        const newCard: SrsCard = {
          id: crypto.randomUUID(),
          type: "vocabulary",
          lemma,
          front: word,
          back: definition.definition,
          context: definition.example ?? "",
          source: "manual",
          sourceId: crypto.randomUUID(),
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          nextReview: new Date(),
          masteryLevel: "new",
          createdAt: new Date(),
          lastReviewedAt: null,
        };
        await db.cards.add(newCard);
      }
      setAddedKeys((prev) => new Set(prev).add(key));
    } finally {
      setAddingKey(null);
    }
  };

  const handleChipClick = (word: string): void => {
    setQuery(word);
    void lookupWord(word);
  };

  const audioUrl = entries ? findAudioUrl(entries) : null;
  const phoneticText = entries ? findPhoneticText(entries) : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
            size="icon"
            aria-label="Open dictionary"
          />
        }
      >
        <BookA className="h-6 w-6" />
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:w-[420px] sm:max-w-[420px]"
      >
        <SheetHeader>
          <SheetTitle>Dictionary</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a word..."
                className="h-12 flex-1 text-base"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                disabled={!query.trim() || isLoading}
                className="min-h-[44px] sm:w-auto"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Look Up
              </Button>
            </div>

            {history.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Recent:</span>
                {history.map((word) => (
                  <button
                    key={word}
                    type="button"
                    onClick={() => handleChipClick(word)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {word}
                  </button>
                ))}
              </div>
            )}
          </form>

          {isLoading && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Looking up...</p>
              </CardContent>
            </Card>
          )}

          {error && !isLoading && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground break-words">{error}</p>
              </CardContent>
            </Card>
          )}

          {!entries && !isLoading && !error && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Search className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Type an English word to look up its definition, pronunciation,
                  and usage.
                </p>
              </CardContent>
            </Card>
          )}

          {entries && !isLoading && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold break-words">{entries[0].word}</h2>
                {phoneticText && (
                  <span className="text-base text-muted-foreground">
                    {phoneticText}
                  </span>
                )}
                {audioUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="min-h-[44px] min-w-[44px]"
                    onClick={() => handlePlayAudio(audioUrl)}
                    aria-label="Play pronunciation"
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {entries.map((entry, entryIdx) =>
                entry.meanings.map((meaning, meaningIdx) => (
                  <Card key={`${entryIdx}-${meaningIdx}`}>
                    <CardHeader>
                      <CardTitle className="text-base italic font-semibold">
                        {meaning.partOfSpeech}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <ol className="flex flex-col gap-3">
                        {meaning.definitions.map((def, defIdx) => {
                          const key = `${entry.word}:${def.definition}`;
                          const isAdded = addedKeys.has(key);
                          const isAdding = addingKey === key;
                          return (
                            <li key={defIdx} className="flex flex-col gap-1.5">
                              <p className="text-sm leading-relaxed">
                                <span className="mr-1.5 text-muted-foreground">
                                  {defIdx + 1}.
                                </span>
                                {def.definition}
                              </p>
                              {def.example && (
                                <p className="pl-5 text-sm italic text-muted-foreground break-words">
                                  &ldquo;{def.example}&rdquo;
                                </p>
                              )}
                              <div className="pl-5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isAdded ? "secondary" : "outline"}
                                  disabled={isAdded || isAdding}
                                  className="min-h-[44px]"
                                  onClick={() => void handleAddToSrs(entry.word, def)}
                                >
                                  {isAdded ? (
                                    <>
                                      <Check className="h-3.5 w-3.5" />
                                      Added!
                                    </>
                                  ) : isAdding ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Plus className="h-3.5 w-3.5" />
                                      Add to SRS
                                    </>
                                  )}
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>

                      {meaning.synonyms && meaning.synonyms.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-muted-foreground">
                            Synonyms:
                          </span>
                          {meaning.synonyms.map((syn) => (
                            <Badge
                              key={syn}
                              variant="secondary"
                              className="cursor-pointer"
                              onClick={() => handleChipClick(syn)}
                            >
                              {syn}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {meaning.antonyms && meaning.antonyms.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-muted-foreground">
                            Antonyms:
                          </span>
                          {meaning.antonyms.map((ant) => (
                            <Badge
                              key={ant}
                              variant="outline"
                              className="cursor-pointer"
                              onClick={() => handleChipClick(ant)}
                            >
                              {ant}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
