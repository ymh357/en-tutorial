"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, FileText, Link as LinkIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/db";
import { useReadingSessions } from "@/hooks/use-db";
import { UNKNOWN_DIFFICULTY, type ReadingSession } from "@/lib/types";

const DIFFICULTIES = ["A2", "B1", "B2", "C1"] as const;

const TOPICS = [
  "Technology",
  "Business",
  "Science",
  "Culture",
  "Daily Life",
  "Health",
  "Education",
  "Environment",
] as const;

const SOURCE_LABEL: Record<ReadingSession["source"], string> = {
  ai_generated: "AI Generated",
  pasted: "Pasted",
  url: "URL",
};

const SOURCE_BADGE_VARIANT: Record<
  ReadingSession["source"],
  "default" | "secondary" | "outline"
> = {
  ai_generated: "default",
  pasted: "secondary",
  url: "outline",
};

const createSession = async (
  input: Partial<ReadingSession> & Pick<ReadingSession, "title" | "content" | "source">
): Promise<string> => {
  const id = crypto.randomUUID();
  const session: ReadingSession = {
    id,
    title: input.title,
    content: input.content,
    source: input.source,
    sourceUrl: input.sourceUrl,
    difficulty: input.difficulty ?? UNKNOWN_DIFFICULTY,
    lookups: [],
    sentenceAnalyses: [],
    vocabCoverage: 0,
    duration: 0,
    createdAt: new Date(),
  };
  await db.readingSessions.add(session);
  return id;
};

interface ComprehensionQuestion {
  question: string;
  type: "main-idea" | "inference" | "prediction" | string;
}

interface GeneratedArticle {
  title: string;
  content: string;
  comprehensionQuestions: ComprehensionQuestion[];
}

const parseGeneratedArticle = (raw: string, fallbackTitle: string): GeneratedArticle => {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(text) as Partial<GeneratedArticle>;
    if (
      typeof parsed.title === "string" &&
      typeof parsed.content === "string" &&
      Array.isArray(parsed.comprehensionQuestions)
    ) {
      return {
        title: parsed.title,
        content: parsed.content,
        comprehensionQuestions: parsed.comprehensionQuestions,
      };
    }
  } catch {
    // Fall through to plain-text handling below.
  }

  // Fallback: treat the response as plain text with the title on the first line.
  const lines = raw.trim().split("\n");
  const firstLine = lines[0].trim();
  const title = firstLine.replace(/^#+\s*/, "") || fallbackTitle;
  const body = lines.slice(1).join("\n").trim() || raw;
  return { title, content: body, comprehensionQuestions: [] };
};

const AiGenerateTab = ({
  onSessionCreated,
}: {
  onSessionCreated: (id: string) => void;
}) => {
  const [difficulty, setDifficulty] = useState<string>("B1");
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedArticle | null>(null);
  const [prediction, setPrediction] = useState("");

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setGenerated(null);
    setPrediction("");
    try {
      const system = `You are an English teacher creating reading material. Generate a 300-500 word article about ${topic} at ${difficulty} level. Use vocabulary and grammar appropriate for that level. Write naturally — this should feel like a real article, not a textbook exercise. Also generate 3 comprehension questions covering different reading skills: one main-idea question, one inference question, and one prediction question. Return ONLY valid JSON (no markdown fences, no explanation) in this exact format: { "title": "article title", "content": "the full article body", "comprehensionQuestions": [ { "question": "What is the main idea of this passage?", "type": "main-idea" }, { "question": "What does the author mean by '...'?", "type": "inference" }, { "question": "What can you predict will happen next?", "type": "prediction" } ] }`;
      const prompt = `Generate an article about ${topic}`;

      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, system }),
      });

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data: { content?: string; error?: string } = await res.json();
      if (data.error || !data.content) {
        throw new Error(data.error || "No content returned");
      }

      const article = parseGeneratedArticle(data.content, `AI Generated: ${topic}`);
      setGenerated(article);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate article. Please try again."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartReading = async () => {
    if (!generated) return;
    setIsStarting(true);
    try {
      const id = await createSession({
        title: generated.title,
        content: generated.content,
        source: "ai_generated",
        difficulty,
      });
      if (generated.comprehensionQuestions.length > 0) {
        localStorage.setItem(
          `en-tutor-reading-questions-${id}`,
          JSON.stringify(generated.comprehensionQuestions)
        );
      }
      onSessionCreated(id);
    } finally {
      setIsStarting(false);
    }
  };

  if (generated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{generated.title}</CardTitle>
          <CardDescription>
            Before you start reading, take a moment to predict the content.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Based on the title &ldquo;{generated.title}&rdquo;, what do you
              think this article will be about?
            </Label>
            <Textarea
              placeholder="Write a brief prediction..."
              value={prediction}
              onChange={(e) => setPrediction(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setGenerated(null);
                setPrediction("");
              }}
              disabled={isStarting}
            >
              Generate a Different Article
            </Button>
            <Button onClick={handleStartReading} disabled={isStarting}>
              {isStarting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                "Start Reading"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate an Article</CardTitle>
        <CardDescription>
          Let AI write a short article tailored to your level and interests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Difficulty</Label>
            <Select
              value={difficulty}
              onValueChange={(value) => value && setDifficulty(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTIES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Topic</Label>
            <Select
              value={topic}
              onValueChange={(value) => value && setTopic(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOPICS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate Article
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

const PasteTextTab = ({
  onSessionCreated,
}: {
  onSessionCreated: (id: string) => void;
}) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleStart = async () => {
    if (!content.trim()) return;
    setIsCreating(true);
    try {
      const id = await createSession({
        title: title.trim() || "Untitled",
        content: content.trim(),
        source: "pasted",
      });
      onSessionCreated(id);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paste Text</CardTitle>
        <CardDescription>
          Paste any English text you want to read and study.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Title (optional)</Label>
          <Input
            placeholder="e.g. My Article"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Text</Label>
          <Textarea
            placeholder="Paste your English text here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[240px]"
          />
        </div>
        <Button onClick={handleStart} disabled={!content.trim() || isCreating}>
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting...
            </>
          ) : (
            "Start Reading"
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

const ImportUrlTab = ({
  onSessionCreated,
}: {
  onSessionCreated: (id: string) => void;
}) => {
  const [url, setUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<{
    title: string;
    content: string;
  } | null>(null);

  const handleExtract = async () => {
    if (!url.trim()) return;
    setIsExtracting(true);
    setError(null);
    setExtracted(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data: {
        title: string;
        content: string;
        error?: string | null;
        truncated?: boolean;
        isEnglish?: boolean;
        wordCount?: number;
      } = await res.json();

      if (!data.content) {
        setError(
          (data.error || "Could not extract content from this URL.") +
            " Try pasting the text instead."
        );
        return;
      }

      if (data.error) {
        // Non-fatal warning (e.g. not English)
        setError(data.error);
      }

      setExtracted({ title: data.title, content: data.content });
    } catch {
      setError("Failed to reach the extraction service. Try pasting the text instead.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStart = async () => {
    if (!extracted) return;
    setIsCreating(true);
    try {
      const id = await createSession({
        title: extracted.title || "Untitled",
        content: extracted.content,
        source: "url",
        sourceUrl: url.trim(),
      });
      onSessionCreated(id);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from URL</CardTitle>
        <CardDescription>
          Paste a link to an article and we&apos;ll extract the readable text.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleExtract();
            }}
          />
          <Button
            onClick={handleExtract}
            disabled={!url.trim() || isExtracting}
            className="shrink-0"
          >
            {isExtracting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Extract"
            )}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {extracted && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="font-medium">{extracted.title}</div>
            <p className="text-sm text-muted-foreground line-clamp-4">
              {extracted.content.slice(0, 200)}
              {extracted.content.length > 200 ? "..." : ""}
            </p>
            <Button onClick={handleStart} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                "Start Reading"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ReadingHistory = ({
  sessions,
  onSelect,
}: {
  sessions: ReadingSession[];
  onSelect: (id: string) => void;
}) => {
  if (sessions.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Reading History</h2>
      <div className="space-y-2">
        {sessions.map((session) => (
          <Card
            key={session.id}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => onSelect(session.id)}
          >
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium line-clamp-1">
                  {session.title}
                </CardTitle>
                <Badge variant={SOURCE_BADGE_VARIANT[session.source]}>
                  {SOURCE_LABEL[session.source]}
                </Badge>
              </div>
              <CardDescription className="text-xs flex items-center gap-2">
                <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                <span>&middot;</span>
                <span>
                  {session.content.trim().split(/\s+/).filter(Boolean).length}{" "}
                  words
                </span>
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

const ReaderPage = () => {
  const router = useRouter();
  const recentSessions = useReadingSessions(10);

  const goToSession = (id: string) => {
    router.push(`/reader/${id}`);
  };

  return (
    <div className="max-w-4xl space-y-8 px-4 md:px-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Reading Practice</h1>
        <p className="text-muted-foreground">
          Choose content to read — generate an article, paste your own text,
          or import from a URL.
        </p>
      </div>

      <Tabs defaultValue="ai">
        <div className="overflow-x-auto">
          <TabsList className="w-max min-w-full sm:w-auto">
            <TabsTrigger value="ai" className="whitespace-nowrap">
              <Sparkles className="h-4 w-4" />
              AI Generate
            </TabsTrigger>
            <TabsTrigger value="paste" className="whitespace-nowrap">
              <FileText className="h-4 w-4" />
              Paste Text
            </TabsTrigger>
            <TabsTrigger value="url" className="whitespace-nowrap">
              <LinkIcon className="h-4 w-4" />
              Import URL
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="ai" className="pt-4">
          <AiGenerateTab onSessionCreated={goToSession} />
        </TabsContent>
        <TabsContent value="paste" className="pt-4">
          <PasteTextTab onSessionCreated={goToSession} />
        </TabsContent>
        <TabsContent value="url" className="pt-4">
          <ImportUrlTab onSessionCreated={goToSession} />
        </TabsContent>
      </Tabs>

      <ReadingHistory sessions={recentSessions} onSelect={goToSession} />
    </div>
  );
};

export default ReaderPage;
