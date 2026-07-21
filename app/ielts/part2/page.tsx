"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Mic, Shuffle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pickRandomCard, type Part2Card } from "@/lib/ielts-part2-cards";

const LAST_CARD_KEY = "ielts-part2-last-card";

const CATEGORY_COLOR: Record<Part2Card["category"], string> = {
  person: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  place: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  object: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  event: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  activity: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

const IeltsPart2Page = () => {
  const router = useRouter();
  // Start empty so the server-rendered HTML is stable; the real card is picked
  // in the mount effect where localStorage is available (avoids hydration
  // mismatch and never touches localStorage during render).
  const [card, setCard] = useState<Part2Card | null>(null);

  useEffect(() => {
    // Pick on the client only: pickRandomCard() uses Math.random(), so running
    // it during render would desync server/client HTML. localStorage is also
    // client-only. This is a genuine "sync with an external system on mount"
    // effect, not derived render state — hence the scoped rule opt-out.
    const lastId = localStorage.getItem(LAST_CARD_KEY) ?? undefined;
    const picked = pickRandomCard(lastId);
    localStorage.setItem(LAST_CARD_KEY, picked.id);
    setCard(picked); // eslint-disable-line react-hooks/set-state-in-effect -- mount-time pick from Math.random + localStorage
  }, []);

  const handleShuffle = () => {
    const picked = pickRandomCard(card?.id);
    localStorage.setItem(LAST_CARD_KEY, picked.id);
    setCard(picked);
  };

  const handleStart = () => {
    if (!card) return;
    const id = crypto.randomUUID();
    router.push(`/ielts/part2/${id}?card=${card.id}`);
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">IELTS Speaking — Part 2</h1>
        <p className="text-muted-foreground">
          The long turn: you get 60 seconds to prepare, then speak for 1–2
          minutes on the cue card below. Your response is scored afterwards.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg">
              {card ? card.topic : "Loading a cue card…"}
            </CardTitle>
            {card && (
              <Badge
                variant="secondary"
                className={CATEGORY_COLOR[card.category]}
              >
                {card.category}
              </Badge>
            )}
          </div>
          <CardDescription>You should say:</CardDescription>
        </CardHeader>
        {card && (
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {card.bullets.map((bullet, index) => (
                <li key={index}>{bullet}</li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          size="lg"
          className="min-h-[44px]"
          onClick={handleStart}
          disabled={!card}
        >
          <Mic className="h-5 w-5 mr-1" />
          Start Part 2
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="min-h-[44px]"
          onClick={handleShuffle}
          disabled={!card}
        >
          <Shuffle className="h-5 w-5 mr-1" />
          换一题
        </Button>
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" />
          60s prep · 1–2 min talk
        </span>
        <Link
          href="/history"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <History className="h-4 w-4" />
          View history
        </Link>
      </div>
    </div>
  );
};

export default IeltsPart2Page;
