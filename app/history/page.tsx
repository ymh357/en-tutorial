"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  History as HistoryIcon,
  MessageSquare,
  BookOpen,
  PenLine,
  Headphones,
  Languages,
  ClipboardCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/db";
import type { AssessmentResult } from "@/app/assessment/page";

type ModuleType =
  | "conversation"
  | "reading"
  | "writing"
  | "listening"
  | "translation"
  | "assessment";

interface HistoryEntry {
  key: string;
  module: ModuleType;
  createdAt: Date;
  title: string;
  summary: string;
  href: string | null;
}

const MODULE_LABEL: Record<ModuleType, string> = {
  conversation: "Conversation",
  reading: "Reading",
  writing: "Writing",
  listening: "Listening",
  translation: "Translation",
  assessment: "Assessment",
};

const MODULE_ICON: Record<ModuleType, typeof MessageSquare> = {
  conversation: MessageSquare,
  reading: BookOpen,
  writing: PenLine,
  listening: Headphones,
  translation: Languages,
  assessment: ClipboardCheck,
};

const MODULE_BADGE_CLASS: Record<ModuleType, string> = {
  conversation: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  reading: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  writing: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400",
  listening: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400",
  translation: "bg-pink-100 text-pink-700 dark:bg-pink-950/50 dark:text-pink-400",
  assessment: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400",
};

const ASSESSMENTS_STORAGE_KEY = "en-tutor-assessments";

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max).trim()}...` : text;

const loadAssessments = (): AssessmentResult[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ASSESSMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssessmentResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const formatGroupLabel = (date: Date): string => {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(date)) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const FILTER_TABS: Array<{ value: "all" | ModuleType; label: string }> = [
  { value: "all", label: "All" },
  { value: "conversation", label: "Conversation" },
  { value: "reading", label: "Reading" },
  { value: "writing", label: "Writing" },
  { value: "listening", label: "Listening" },
  { value: "translation", label: "Translation" },
  { value: "assessment", label: "Assessment" },
];

const HistoryPage = () => {
  const [filter, setFilter] = useState<"all" | ModuleType>("all");
  const assessments = useMemo(() => loadAssessments(), []);

  const conversations = useLiveQuery(
    () => db.conversations.orderBy("createdAt").reverse().toArray(),
    []
  );
  const readingSessions = useLiveQuery(
    () => db.readingSessions.orderBy("createdAt").reverse().toArray(),
    []
  );
  const writingSessions = useLiveQuery(
    () => db.writingSessions.orderBy("createdAt").reverse().toArray(),
    []
  );
  const listeningExercises = useLiveQuery(
    () => db.listeningExercises.orderBy("createdAt").reverse().toArray(),
    []
  );
  const translationExercises = useLiveQuery(
    () => db.translationExercises.orderBy("createdAt").reverse().toArray(),
    []
  );

  const entries = useMemo<HistoryEntry[]>(() => {
    const all: HistoryEntry[] = [];

    for (const c of conversations ?? []) {
      all.push({
        key: `conversation-${c.id}`,
        module: "conversation",
        createdAt: new Date(c.createdAt),
        title: `Conversation: ${c.scenario}`,
        summary: c.review
          ? `Fluency ${c.review.scores.fluency}/10 · ${Math.round(c.duration / 60)} min`
          : `${Math.round(c.duration / 60)} min · not reviewed`,
        href: `/conversation/${c.id}/review`,
      });
    }

    for (const r of readingSessions ?? []) {
      all.push({
        key: `reading-${r.id}`,
        module: "reading",
        createdAt: new Date(r.createdAt),
        title: `Reading: ${r.title}`,
        summary: `${r.vocabCoverage}% vocab coverage · ${Math.round(r.duration / 60)} min`,
        href: `/reader/${r.id}`,
      });
    }

    for (const w of writingSessions ?? []) {
      all.push({
        key: `writing-${w.id}`,
        module: "writing",
        createdAt: new Date(w.createdAt),
        title: `Writing: ${w.taskType}`,
        summary: w.review
          ? `Score ${w.review.score}/10 · ${w.wordCount} words`
          : `${w.wordCount} words · not reviewed`,
        href: `/writing/${w.id}`,
      });
    }

    for (const l of listeningExercises ?? []) {
      all.push({
        key: `listening-${l.id}`,
        module: "listening",
        createdAt: new Date(l.createdAt),
        title: `Listening: ${l.mode}`,
        summary: `"${truncate(l.prompt, 60)}" · ${l.accuracy}% accuracy`,
        href: null,
      });
    }

    for (const t of translationExercises ?? []) {
      all.push({
        key: `translation-${t.id}`,
        module: "translation",
        createdAt: new Date(t.createdAt),
        title: `Translation: ${t.mode}`,
        summary: `Score ${t.score}/10 · "${truncate(t.chinese, 40)}"`,
        href: null,
      });
    }

    assessments.forEach((a, idx) => {
      all.push({
        key: `assessment-${a.date}-${idx}`,
        module: "assessment",
        createdAt: new Date(a.date),
        title: "Full Assessment",
        summary: `Overall ${a.overallScore} · ${a.levelBand}`,
        href: null,
      });
    });

    return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [
    conversations,
    readingSessions,
    writingSessions,
    listeningExercises,
    translationExercises,
    assessments,
  ]);

  const filteredEntries = useMemo(
    () =>
      filter === "all" ? entries : entries.filter((e) => e.module === filter),
    [entries, filter]
  );

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of filteredEntries) {
      const label = formatGroupLabel(entry.createdAt);
      const list = map.get(label);
      if (list) {
        list.push(entry);
      } else {
        map.set(label, [entry]);
      }
    }
    return Array.from(map.entries());
  }, [filteredEntries]);

  const isLoading =
    conversations === undefined ||
    readingSessions === undefined ||
    writingSessions === undefined ||
    listeningExercises === undefined ||
    translationExercises === undefined;

  return (
    <div className="max-w-3xl space-y-6 p-4 md:space-y-8 md:p-6">
      <div>
        <h1 className="text-xl font-bold mb-2 md:text-2xl flex items-center gap-2">
          <HistoryIcon className="h-5 w-5" />
          Practice History
        </h1>
        <p className="text-muted-foreground text-sm">
          Review everything you have practiced, across every module.
        </p>
      </div>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as "all" | ModuleType)}
      >
        <div className="overflow-x-auto">
          <TabsList className="w-max flex-nowrap whitespace-nowrap">
            {FILTER_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="whitespace-nowrap"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {isLoading ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">Loading history...</p>
          </CardContent>
        </Card>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-lg font-medium">No history yet.</p>
            <p className="text-sm text-muted-foreground">
              Complete a conversation, reading, writing, listening, or
              translation exercise to see it here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([groupLabel, groupEntries]) => (
            <div key={groupLabel} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {groupLabel}
              </h2>
              <div className="space-y-2">
                {groupEntries.map((entry) => {
                  const Icon = MODULE_ICON[entry.module];
                  const content = (
                    <Card
                      className={
                        entry.href
                          ? "hover:border-primary/50 transition-colors"
                          : ""
                      }
                    >
                      <CardContent className="py-3 px-4 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`gap-1 border-transparent ${MODULE_BADGE_CLASS[entry.module]}`}
                            >
                              <Icon className="h-3 w-3" />
                              {MODULE_LABEL[entry.module]}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {entry.createdAt.toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm font-medium break-words">
                          {entry.title}
                        </p>
                        <p className="text-xs text-muted-foreground break-words">
                          {entry.summary}
                        </p>
                      </CardContent>
                    </Card>
                  );
                  return entry.href ? (
                    <Link key={entry.key} href={entry.href} className="block">
                      {content}
                    </Link>
                  ) : (
                    <div key={entry.key}>{content}</div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
