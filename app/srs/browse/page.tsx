"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import type { Card as CardType, CardSource, MasteryLevel } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

const masteryBadgeVariant: Record<
  MasteryLevel,
  "default" | "secondary" | "outline"
> = {
  new: "outline",
  learning: "secondary",
  familiar: "secondary",
  mastered: "default",
};

type MasteryFilter = "all" | MasteryLevel;

const filterTabs: Array<{ value: MasteryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "learning", label: "Learning" },
  { value: "familiar", label: "Familiar" },
  { value: "mastered", label: "Mastered" },
];

const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
};

const lemmatize = (word: string): string => word.trim().toLowerCase();

const AddCardDialog = () => {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [context, setContext] = useState("");
  const [lemma, setLemma] = useState("");
  const [lemmaTouched, setLemmaTouched] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = (): void => {
    setWord("");
    setDefinition("");
    setContext("");
    setLemma("");
    setLemmaTouched(false);
    setDuplicateWarning(false);
  };

  const handleWordChange = (value: string): void => {
    setWord(value);
    if (!lemmaTouched) {
      setLemma(lemmatize(value));
    }
    setDuplicateWarning(false);
  };

  const handleLemmaChange = (value: string): void => {
    setLemma(value);
    setLemmaTouched(true);
    setDuplicateWarning(false);
  };

  const handleSubmit = async (): Promise<void> => {
    const trimmedWord = word.trim();
    const trimmedDefinition = definition.trim();
    const trimmedLemma = lemma.trim() || lemmatize(trimmedWord);

    if (!trimmedWord || !trimmedDefinition) return;

    setIsSubmitting(true);
    try {
      const existing = await dbHelpers.getCardByLemma(trimmedLemma);
      if (existing && !duplicateWarning) {
        setDuplicateWarning(true);
        setIsSubmitting(false);
        return;
      }

      const newCard: CardType = {
        id: crypto.randomUUID(),
        type: "vocabulary",
        lemma: trimmedLemma,
        front: trimmedWord,
        back: trimmedDefinition,
        context: context.trim(),
        source: "manual",
        sourceId: "",
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: new Date(),
        masteryLevel: "new",
        createdAt: new Date(),
        lastReviewedAt: null,
      };

      await db.cards.put(newCard);
      resetForm();
      setOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Add Card
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add vocabulary card</DialogTitle>
          <DialogDescription>
            Manually add a word to your SRS deck.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="word">Word</Label>
            <Input
              id="word"
              value={word}
              onChange={(e) => handleWordChange(e.target.value)}
              placeholder="e.g. ubiquitous"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="definition">Definition</Label>
            <Textarea
              id="definition"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="e.g. present, appearing, or found everywhere"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="context">Context sentence (optional)</Label>
            <Textarea
              id="context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. Smartphones have become ubiquitous."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lemma">Lemma</Label>
            <Input
              id="lemma"
              value={lemma}
              onChange={(e) => handleLemmaChange(e.target.value)}
              placeholder="Auto-filled from word"
            />
          </div>

          {duplicateWarning && (
            <p className="text-sm text-destructive">
              A card with this lemma already exists. Submit again to add it
              anyway.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!word.trim() || !definition.trim() || isSubmitting}
          >
            {duplicateWarning ? "Add anyway" : "Add card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DeleteCardButton = ({ cardId }: { cardId: string }) => {
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async (): Promise<void> => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await db.cards.delete(cardId);
    setConfirming(false);
  };

  return (
    <Button
      variant={confirming ? "destructive" : "ghost"}
      size="icon-sm"
      aria-label="Delete card"
      onClick={handleDelete}
      onBlur={() => setConfirming(false)}
    >
      <Trash2 />
    </Button>
  );
};

const CardRow = ({ card }: { card: CardType }) => {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{card.front}</p>
            <Badge variant="outline">{sourceLabels[card.source]}</Badge>
            <Badge variant={masteryBadgeVariant[card.masteryLevel]}>
              {masteryLabels[card.masteryLevel]}
            </Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {truncate(card.back, 100)}
          </p>
          <p className="text-xs text-muted-foreground">
            Next review: {formatDate(card.nextReview)}
          </p>
        </div>
        <DeleteCardButton cardId={card.id} />
      </CardContent>
    </Card>
  );
};

const BrowsePage = () => {
  const [masteryFilter, setMasteryFilter] = useState<MasteryFilter>("all");
  const [search, setSearch] = useState("");

  const allCards = useLiveQuery(() => db.cards.toArray(), []);

  const stats = useMemo(() => {
    const counts: Record<MasteryLevel, number> = {
      new: 0,
      learning: 0,
      familiar: 0,
      mastered: 0,
    };
    for (const card of allCards ?? []) {
      counts[card.masteryLevel] += 1;
    }
    return counts;
  }, [allCards]);

  const filteredCards = useMemo(() => {
    if (!allCards) return [];
    const query = search.trim().toLowerCase();
    return allCards
      .filter((card) =>
        masteryFilter === "all" ? true : card.masteryLevel === masteryFilter
      )
      .filter((card) => {
        if (!query) return true;
        return (
          card.front.toLowerCase().includes(query) ||
          card.back.toLowerCase().includes(query)
        );
      })
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [allCards, masteryFilter, search]);

  const isLoading = allCards === undefined;
  const totalCards = allCards?.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Browse Cards</h1>
        <AddCardDialog />
      </div>

      <div className="grid grid-cols-5 gap-2">
        <Card size="sm">
          <CardContent className="space-y-0.5 text-center">
            <p className="text-xl font-bold">{totalCards}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="space-y-0.5 text-center">
            <p className="text-xl font-bold">{stats.new}</p>
            <p className="text-xs text-muted-foreground">New</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="space-y-0.5 text-center">
            <p className="text-xl font-bold">{stats.learning}</p>
            <p className="text-xs text-muted-foreground">Learning</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="space-y-0.5 text-center">
            <p className="text-xl font-bold">{stats.familiar}</p>
            <p className="text-xs text-muted-foreground">Familiar</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="space-y-0.5 text-center">
            <p className="text-xl font-bold">{stats.mastered}</p>
            <p className="text-xs text-muted-foreground">Mastered</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards..."
            className="pl-8"
          />
        </div>

        <Tabs
          value={masteryFilter}
          onValueChange={(value) => setMasteryFilter(value as MasteryFilter)}
        >
          <div className="overflow-x-auto">
            <TabsList className="w-max flex-nowrap whitespace-nowrap">
              {filterTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading cards...
        </p>
      ) : totalCards === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-lg font-medium">No cards yet.</p>
            <p className="text-sm text-muted-foreground">
              Cards will appear here as you learn through conversations,
              reading, and writing.
            </p>
          </CardContent>
        </Card>
      ) : filteredCards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No cards match your search or filter.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {filteredCards.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
};

export default BrowsePage;
