"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Flame, Library, Volume2 } from "lucide-react";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { useDueCards } from "@/hooks/use-db";
import {
  computeNextReview,
  getNextIntervals,
  ratingLabels,
  type Rating,
} from "@/lib/srs-algorithm";
import type { Card as CardType, CardSource, MasteryLevel } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { speak } from "@/lib/tts";

const sourceLabels: Record<CardSource, string> = {
  conversation: "Conversation",
  reading: "Reading",
  writing: "Writing",
  translate: "Translation",
  manual: "Manual",
};

const masteryLabels: Record<MasteryLevel, string> = {
  new: "New",
  learning: "Learning",
  familiar: "Familiar",
  mastered: "Mastered",
};

const formatInterval = (days: number): string => {
  if (days < 1 / 24) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    return `${minutes}m`;
  }
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours}h`;
  }
  const rounded = Math.round(days);
  return `${rounded}d`;
};

const getNow = (): number => Date.now();

const getEncouragement = (cardsReviewed: number): string => {
  if (cardsReviewed < 10) return "Nice warm-up!";
  if (cardsReviewed <= 30) return "Great session!";
  return "Incredible dedication!";
};

const formatTimeSpent = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

const SrsPage = () => {
  const dueCards = useDueCards(50);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [startedAt] = useState(getNow);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [streak, setStreak] = useState<{ current: number; longest: number } | null>(
    null
  );

  const totalCards = dueCards.length;
  const currentCard: CardType | undefined = dueCards[index];

  const nextIntervals = useMemo(() => {
    if (!currentCard) return null;
    return getNextIntervals(currentCard);
  }, [currentCard]);

  const handleShowAnswer = (): void => {
    setShowAnswer(true);
  };

  const handleSpeak = (): void => {
    if (currentCard) void speak(currentCard.front);
  };

  const handleRate = async (rating: Rating): Promise<void> => {
    if (!currentCard) return;
    const result = computeNextReview(currentCard, rating);
    await db.cards.update(currentCard.id, {
      ...result,
      lastReviewedAt: new Date(),
    });
    await dbHelpers.incrementTodayStat("srsReviewed");

    setReviewedCount((count) => count + 1);
    setShowAnswer(false);

    if (index + 1 >= totalCards) {
      setFinishedAt(getNow());
      setSessionDone(true);
      const streakResult = await dbHelpers.updateStreak();
      setStreak(streakResult);
    } else {
      setIndex((i) => i + 1);
    }
  };

  // Empty state: nothing was due at all.
  if (totalCards === 0 && !sessionDone) {
    return (
      <div className="mx-auto w-full space-y-6 md:max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Review</h1>
          <Button variant="outline" size="sm" render={<Link href="/srs/browse" />}>
            <Library className="h-4 w-4" />
            Browse & Manage
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-lg font-medium">All caught up!</p>
            <p className="text-sm text-muted-foreground">
              No cards to review right now.
            </p>
            <Button variant="outline" render={<Link href="/srs/browse" />}>
              Browse all cards
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Session summary: all due cards have been reviewed.
  if (sessionDone) {
    const timeSpent = finishedAt ? finishedAt - startedAt : 0;
    return (
      <div className="mx-auto w-full space-y-6 md:max-w-2xl">
        <h1 className="text-2xl font-bold">Review</h1>
        <Card>
          <CardHeader>
            <CardTitle>{getEncouragement(reviewedCount)}</CardTitle>
            <CardDescription>Session complete — here&apos;s your summary.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-2xl font-bold">{reviewedCount}</p>
                <p className="text-sm text-muted-foreground">Cards reviewed</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-2xl font-bold">{formatTimeSpent(timeSpent)}</p>
                <p className="text-sm text-muted-foreground">Time spent</p>
              </div>
            </div>

            {streak && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-4">
                <Flame className="size-5 shrink-0 text-orange-500" />
                <div>
                  <p className="text-sm font-medium">
                    {streak.current} day{streak.current === 1 ? "" : "s"} streak
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Best: {streak.longest} days
                  </p>
                </div>
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground italic">
              Consistent daily review is the key to long-term memory.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="w-full sm:flex-1" render={<Link href="/" />}>
                Back to Dashboard
              </Button>
              <Button
                variant="outline"
                className="w-full sm:flex-1"
                render={<Link href="/srs/browse" />}
              >
                Browse all cards
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentCard || !nextIntervals) return null;

  const remaining = totalCards - index;
  const progressValue = (index / totalCards) * 100;

  return (
    <div className="mx-auto w-full space-y-6 md:max-w-2xl">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Review</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {remaining} card{remaining === 1 ? "" : "s"} remaining
            </span>
            <Button variant="outline" size="sm" render={<Link href="/srs/browse" />}>
              <Library className="h-4 w-4" />
              Browse
            </Button>
          </div>
        </div>
        <Progress value={progressValue}>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Badge variant="outline">{sourceLabels[currentCard.source]}</Badge>
            <Badge variant="secondary">{masteryLabels[currentCard.masteryLevel]}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-center gap-3 py-8">
            <p className="text-center text-3xl font-semibold">{currentCard.front}</p>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Pronounce"
              onClick={handleSpeak}
            >
              <Volume2 />
            </Button>
          </div>

          {showAnswer && (
            <div className="space-y-3 rounded-lg bg-muted/50 p-4">
              <p className="text-base font-medium">{currentCard.back}</p>
              {currentCard.context && (
                <p className="text-sm text-muted-foreground italic">
                  &ldquo;{currentCard.context}&rdquo;
                </p>
              )}
              {currentCard.collocations && currentCard.collocations.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium">Common collocations:</p>
                  <p className="text-muted-foreground">
                    {currentCard.collocations.join("; ")}
                  </p>
                </div>
              )}
              {currentCard.wordFamily && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Word family: </span>
                  {currentCard.wordFamily}
                </p>
              )}
            </div>
          )}

          {!showAnswer ? (
            <Button className="w-full" onClick={handleShowAnswer}>
              Show Answer
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {([0, 1, 2, 3] as Rating[]).map((rating) => (
                <Button
                  key={rating}
                  variant={rating === 2 ? "default" : "outline"}
                  className="flex h-auto min-h-[44px] flex-col gap-0.5 py-3 text-base md:min-h-0 md:py-2 md:text-sm"
                  onClick={() => handleRate(rating)}
                >
                  <span className="text-sm md:text-sm">{ratingLabels[rating]}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatInterval(nextIntervals[rating])}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SrsPage;
