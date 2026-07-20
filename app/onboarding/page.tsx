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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LEVELS: Array<{ value: CefrLevel; label: string; description: string }> =
  [
    {
      value: "A1",
      label: "A1 - Beginner",
      description:
        "I know a few basic words and phrases. I am just starting out.",
    },
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
    {
      value: "C2",
      label: "C2 - Proficient",
      description:
        "I use English with near-native ease across virtually any context.",
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
